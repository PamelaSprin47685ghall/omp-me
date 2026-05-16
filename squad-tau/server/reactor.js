/**
 * Pure Reactor — f(state) → Fact[].
 * No Date.now(), no console.log, no async, no history scan.
 * Flat rules table — no nested if/else business logic.
 */
import { toURN, sessionURN } from '../shared/identity.js';

const PHASES = ['authoring', 'confirming', 'reviewing'];
const MAX_RETRIES = 5;

function nextPhase(cur) {
    const i = PHASES.indexOf(cur);
    return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null;
}

// ── Rule table ──
// Each rule: { when(state, node?), then(state, node?) → Fact[] }
// perNode rules iterate all nodes; global rules fire once.

const RULES = [
    // R1: UNLOCK — node with no deps or all deps approved → authoring
    {
        perNode: true,
        when: (s, n) => !n.status && (!n.depends_on || n.depends_on.length === 0),
        then: (s, n) => [{ event: 'squad:node_state', payload: { nodeId: n.id, status: 'authoring', epoch: 0 } }],
    },
    {
        perNode: true,
        when: (s, n) => !n.status && n.depends_on && n.depends_on.length > 0,
        skip: (n) => n.status, // only fire for undefined status
        then: (s, n) => {
            const allMet = n.depends_on.every((did) => {
                const dn = s.nodes[did];
                return dn && (dn.status === 'approved' || dn.status === 'failed');
            });
            if (!allMet) return [];
            return [{ event: 'squad:node_state', payload: { nodeId: n.id, status: 'authoring', epoch: 0 } }];
        },
    },

    // R2: CONCURRENCY — active-phase node without pending/active session + capacity → pending_creation
    {
        perNode: true,
        when: (s, n) => PHASES.includes(n.status),
        then: (s, n) => {
            // Has pending or active session already?
            const hasSess = Object.values(s.runtime.sessions).some(
                (sess) =>
                    sess.nodeId === n.id &&
                    (sess.status === 'pending' || sess.status === 'active' || sess.status === 'prompting'),
            );
            if (hasSess) return [];
            // Ended session waiting for R3 to advance? Wait for phase transition first.
            const pendingAdvance = Object.values(s.runtime.sessions).some(
                (sess) => sess.nodeId === n.id && sess.status === 'ended' && !sess._advanced,
            );
            if (pendingAdvance) return [];
            if (s.stats.activeCount >= s.config.maxWorkers) return [];
            const sid = sessionURN(n.id, n.epoch, n.status);
            return [
                {
                    event: 'session:pending_creation',
                    payload: { sessionId: sid, nodeId: n.id, phase: n.status, epoch: n.epoch },
                },
            ];
        },
    },

    // R3: SESSION ADVANCE — ended unprocessed session → advance or reject
    {
        perNode: false,
        when: (s) => Object.values(s.runtime.sessions).some((ss) => ss.status === 'ended' && !ss._advanced),
        then: (s) => {
            const facts = [];
            for (const sid of Object.keys(s.runtime.sessions)) {
                const ss = s.runtime.sessions[sid];
                if (ss.status !== 'ended' || ss._advanced) continue;
                const n = s.nodes[ss.nodeId];
                if (!n) continue;
                if (!ss.reason || ss.reason === 'completed') {
                    const next = nextPhase(ss.phase);
                    facts.push({
                        event: 'node:phase_advanced',
                        payload: { nodeId: ss.nodeId, status: next || 'approved', sessionId: sid, summary: ss.summary },
                    });
                } else {
                    facts.push({
                        event: 'node:rejected',
                        payload: { nodeId: ss.nodeId, sessionId: sid, feedback: ss.errorMessage || ss.reason },
                    });
                }
            }
            return facts;
        },
    },

    // R4: RETRY — rejected node → retry (up the epoch), fail, or freeze
    {
        perNode: true,
        when: (s, n) => n.status === 'rejected' && n.id !== '__or__',
        then: (s, n) => {
            const planCfg = (s.squad && s.squad.planConfig && s.squad.planConfig[n.id]) || {};
            // resetOnRej: freeze into awaiting_replan (terminal — no re-trigger)
            if (planCfg.resetOnRej) {
                return [
                    {
                        event: 'squad:node_state',
                        payload: { nodeId: n.id, status: 'awaiting_replan', epoch: n.epoch || 0 },
                    },
                ];
            }
            const epoch = (n.epoch || 0) + 1;
            const maxR = planCfg.maxRetries ?? MAX_RETRIES;
            if (epoch > maxR) {
                return [{ event: 'node:failed', payload: { nodeId: n.id } }];
            }
            return [{ event: 'squad:node_state', payload: { nodeId: n.id, status: 'authoring', epoch } }];
        },
    },

    // R5: __or__ rejection (L mode) — reset all workers
    {
        perNode: false,
        when: (s) =>
            s.nodes.__or__ && s.nodes.__or__.status === 'rejected' && (s.squad ? s.squad.phase !== 'revising' : true),
        then: (s) => {
            const facts = [];
            for (const id of Object.keys(s.nodes)) {
                if (id === '__or__') continue;
                const n = s.nodes[id];
                if (n.status === 'approved' || n.status === 'failed') {
                    facts.push({
                        event: 'squad:node_state',
                        payload: { nodeId: id, status: 'authoring', epoch: n.epoch },
                    });
                }
            }
            facts.push({
                event: 'squad:node_state',
                payload: { nodeId: '__or__', status: 'reviewing', epoch: (s.nodes.__or__.epoch || 0) + 1 },
            });
            return facts;
        },
    },

    // R6: L mode — __or__ approved → squad:complete
    {
        perNode: false,
        when: (s) => s.nodes.__or__ && s.nodes.__or__.status === 'approved',
        then: (s) => {
            const results = [];
            for (const id of Object.keys(s.nodes)) {
                if (id === '__or__') continue;
                const n = s.nodes[id];
                results.push({ id: n.id, status: n.status, summary: n.summary || null });
            }
            return [{ event: 'squad:complete', payload: { results } }];
        },
    },

    // R8: STEER — active session with pending user messages → pending_prompt
    {
        perNode: false,
        when: (s) =>
            Object.values(s.runtime.sessions).some(
                (ss) => ss.status === 'active' && ss.pendingMessages && ss.pendingMessages.length > 0,
            ),
        then: (s) => {
            const facts = [];
            for (const sid of Object.keys(s.runtime.sessions)) {
                const ss = s.runtime.sessions[sid];
                if (ss.status !== 'active' || !ss.pendingMessages || ss.pendingMessages.length === 0) continue;
                const msg = ss.pendingMessages[0];
                facts.push({
                    event: 'session:pending_prompt',
                    payload: { sessionId: sid, text: msg.content?.[0]?.text || '', messageId: msg.messageId },
                });
            }
            return facts;
        },
    },

    // R7: M mode — all nodes terminal → squad:complete
    {
        perNode: false,
        when: (s) => {
            if (s.nodes.__or__) return false; // L mode, handled by R6
            const ns = Object.values(s.nodes);
            return ns.length > 0 && ns.every((n) => n.status === 'approved' || n.status === 'failed');
        },
        then: (s) => {
            const results = Object.values(s.nodes).map((n) => ({
                id: n.id,
                status: n.status,
                summary: n.summary || null,
            }));
            return [{ event: 'squad:complete', payload: { results } }];
        },
    },
];

export function reactState(state) {
    if (!state.squad || state.squad.status !== 'active') return [];
    const facts = [];
    for (const rule of RULES) {
        if (rule.perNode) {
            for (const id of Object.keys(state.nodes)) {
                const n = state.nodes[id];
                if (rule.skip && rule.skip(n)) continue;
                if (rule.when(state, n)) facts.push(...rule.then(state, n));
            }
        } else {
            if (rule.when(state)) facts.push(...rule.then(state));
        }
    }
    return facts;
}
