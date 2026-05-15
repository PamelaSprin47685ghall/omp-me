/**
 * Rule-based Reactor — f(state, env) → Action[].
 *
 * v8: No idle state, no config in State, epoch instead of retryCount,
 *     first-class faults (session:faulted → auto-retry/fail).
 *
 * State nodes only track dynamic fields. Static topology reads from
 * state.squad.planConfig (populated at squad:init).
 */
import { sessionIdFor } from '../shared/events.js';

const PHASES_DEFAULT = ['authoring', 'confirming', 'reviewing'];
const PHASES_OR = ['reviewing'];
const DEFAULT_MAX_RETRIES = 5;

let _maxWorkers = 3;

// ── Helpers ──

function cfg(state, nodeId) {
    return state.squad.planConfig?.[nodeId] || {};
}

function depsMet(s, n) {
    return (n.depends_on || []).every((id) => s.squad.nodes[id]?.status === 'approved');
}

function hasFailedDep(s, n) {
    return (n.depends_on || []).some((id) => {
        const d = s.squad.nodes[id];
        return d && (d.status === 'failed' || d.status === 'blocked');
    });
}

function countLiveSessions(state) {
    let c = 0;
    for (const sess of Object.values(state.sessions)) {
        if (sess.status !== 'active' && sess.status !== 'creating') continue;
        if (!sess.nodeId) {
            c++;
            continue;
        }
        const node = state.squad.nodes[sess.nodeId];
        if (!node) continue;
        if (node.status === sess.phase && node.epoch === sess.epoch) c++;
    }
    return c;
}

function nodePhases(nodeId) {
    // __or__ always uses single reviewing phase
    return nodeId === '__or__' ? PHASES_OR : PHASES_DEFAULT;
}

function nextPhase(node) {
    const phases = nodePhases(node.id);
    if (node.status === undefined) return phases[0];
    const idx = phases.indexOf(node.status);
    return idx >= 0 ? (phases[idx + 1] ?? null) : null;
}

function isFaulted(sessionId, state) {
    const sess = state.sessions[sessionId];
    return sess?.status === 'faulted';
}

// ── Sub-handlers ──

function handleSessionReturn(state, node, sess) {
    const p = sess.latestReturn;
    const nextEpoch = (node.epoch || 0) + 1;
    const c = cfg(state, node.id);

    if (node.status === 'reviewing') {
        if (p.status === 'ok') {
            return [
                ac('squad:node_state', {
                    nodeId: node.id,
                    status: 'approved',
                    summary: p.reason,
                    affectedFiles: p.affected_files,
                }),
            ];
        }
        if (c.resetOnRej) {
            return [
                ac('squad:node_state', {
                    nodeId: node.id,
                    status: 'rejected',
                    epoch: nextEpoch,
                    feedback: p.reason || '',
                }),
            ];
        }
        if (nextEpoch >= (c.maxRetries || DEFAULT_MAX_RETRIES)) {
            return [ac('squad:node_state', { nodeId: node.id, status: 'failed' })];
        }
        return [
            ac('squad:node_state', {
                nodeId: node.id,
                status: nodePhases(node.id)[0],
                epoch: nextEpoch,
                feedback: p.reason,
            }),
        ];
    }

    const next = nextPhase(node);
    return next ? [ac('squad:node_state', { nodeId: node.id, status: next })] : [];
}

function handleSessionPrompt(state, node, sess) {
    const c = cfg(state, node.id);
    const promptPhase = c.resetOnRej ? 'outer_review' : node.status;
    if (sess.lastPromptedPhase !== promptPhase) {
        return [ac('session:prompting', { nodeId: node.id, sessionId: sess.sessionId, phase: promptPhase })];
    }
    return [];
}

function handleSessionCreate(state, node) {
    if (countLiveSessions(state) >= _maxWorkers) return [];
    const role = node.status;
    const sessionId = sessionIdFor(node.id, role, node.epoch);
    const c = cfg(state, node.id);
    const promptPhase = c.resetOnRej ? 'outer_review' : role;
    return [ac('session:creating', { nodeId: node.id, sessionId, phase: promptPhase, epoch: node.epoch || 0 })];
}

function nodePhaseActions(state, node) {
    const role = node.status;
    const sessionId = sessionIdFor(node.id, role, node.epoch);
    const sess = state.sessions[sessionId];

    if (!sess) return handleSessionCreate(state, node);
    if (sess.status === 'creating') return [];
    if (sess.status === 'faulted') return handleSessionFaulted(state, node, sess);
    if (sess.latestReturn) return handleSessionReturn(state, node, sess);
    return handleSessionPrompt(state, node, sess);
}

function handleSessionFaulted(state, node, sess) {
    const nextEpoch = (node.epoch || 0) + 1;
    const c = cfg(state, node.id);
    if (nextEpoch >= (c.maxRetries || DEFAULT_MAX_RETRIES)) {
        return [ac('squad:node_state', { nodeId: node.id, status: 'failed', epoch: node.epoch })];
    }
    return [
        ac('squad:node_state', {
            nodeId: node.id,
            status: nodePhases(node.id)[0],
            epoch: nextEpoch,
            feedback: sess.faultMessage,
        }),
    ];
}

function workerStats(state) {
    const workers = Object.values(state.squad.nodes).filter((n) => {
        const c = cfg(state, n.id);
        return !c.resetOnRej;
    });
    const allDone =
        workers.length > 0 &&
        workers.every((n) => n.status === 'approved' || n.status === 'failed' || n.status === 'blocked');
    return { workers, allDone };
}

// ── Rule table ──
// No idle state — nodes transition directly from undefined → first phase when deps met.
// Failed deps → blocked (terminal). Faulted sessions → auto-retry.

const RULES = [
    // R1: failed dep → blocked (separated from undefined check for priority)
    {
        when: (s, n) => hasFailedDep(s, n) && n.status !== 'blocked',
        then: (_s, n) => [ac('squad:node_state', { nodeId: n.id, status: 'blocked', summary: 'Blocked by upstream' })],
        perNode: true,
        skip: (_s, n) => n.status === 'blocked',
    },

    // R2: undefined + deps met → first phase (formerly R1+R3 combined)
    {
        when: (s, n) => n.status === undefined && depsMet(s, n),
        then: (_s, n) => {
            const next = nextPhase(n);
            return next ? [ac('squad:node_state', { nodeId: n.id, status: next })] : [];
        },
        perNode: true,
    },

    // R3: active phases → manage sessions
    {
        when: (_s, n) => ['authoring', 'confirming', 'reviewing'].includes(n.status),
        then: (state, node) => nodePhaseActions(state, node),
        perNode: true,
    },

    // R4: __or__ rejected → reset all approved workers (formerly R5)
    {
        when: (s) => {
            const or = s.squad.nodes.__or__;
            return or?.status === 'rejected';
        },
        then: (s) => {
            const actions = [];
            const rejectedNode = s.squad.nodes.__or__;
            const feedback = rejectedNode?.feedback || 'Rejected';
            const nextEpoch = (rejectedNode?.epoch || 0) + 1;

            for (const node of Object.values(s.squad.nodes)) {
                const c = cfg(s, node.id);
                if (c.resetOnRej) continue;
                if (node.status === 'approved') {
                    actions.push(
                        ac('squad:node_state', {
                            nodeId: node.id,
                            status: 'authoring',
                            epoch: (node.epoch || 0) + 1,
                            feedback,
                        }),
                    );
                }
            }
            actions.push(ac('squad:node_state', { nodeId: '__or__', status: undefined, epoch: nextEpoch }));
            return actions;
        },
    },

    // R5: __or__ approved → squad:complete (formerly R6)
    {
        when: (s) => {
            const or = s.squad.nodes.__or__;
            return or?.status === 'approved' && s.squad.status !== 'complete';
        },
        then: (s) => {
            const { workers } = workerStats(s);
            return [
                ac('squad:complete', {
                    results: workers.map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary })),
                }),
            ];
        },
    },

    // R6: M mode — all nodes terminal → squad:complete (formerly R7)
    {
        when: (s) =>
            s.squad.mode !== 'L' &&
            (() => {
                const ns = Object.values(s.squad.nodes);
                return (
                    ns.length > 0 &&
                    ns.every((n) => n.status === 'approved' || n.status === 'failed' || n.status === 'blocked')
                );
            })(),
        then: (s) => [
            ac('squad:complete', {
                results: Object.values(s.squad.nodes).map((n) => ({
                    nodeId: n.id,
                    status: n.status,
                    summary: n.summary,
                })),
            }),
        ],
    },

    // R7: L mode without __or__ — all workers done → squad:complete (formerly R8)
    {
        when: (s) => s.squad.mode === 'L' && !s.squad.nodes.__or__ && workerStats(s).allDone,
        then: (s) => {
            const { workers } = workerStats(s);
            return [
                ac('squad:complete', {
                    results: workers.map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary })),
                }),
            ];
        },
    },
];

function ac(type, payload) {
    return { type, payload };
}

// ── Main reactor ──

export function reactState(state, env = {}) {
    if (state.squad.status !== 'active') return [];
    _maxWorkers = env.maxWorkers || 3;
    const actions = [];
    for (const rule of RULES) {
        if (rule.perNode) {
            for (const node of Object.values(state.squad.nodes)) {
                if (rule.skip?.(state, node)) continue;
                if (rule.when(state, node)) actions.push(...rule.then(state, node));
            }
        } else {
            if (rule.when(state)) actions.push(...rule.then(state));
        }
    }
    return actions;
}
