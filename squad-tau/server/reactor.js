/**
 * Rule-based Reactor — f(state) → Action[].
 *
 * v9: Domain facts (node:work_submitted, node:review_decided) replace raw
 *     tool return plumbing. latestReturn removed. Config read from
 *     state.config (folded from config:capacity_changed).
 *
 *     Initial wavefront computed by squad:init projection — no slow-start.
 *     Rejected nodes handled by dedicated rule (retry/fail).
 *     __or__ reset goes directly to 'reviewing', never through undefined.
 */
import { sessionIdFor } from '../shared/events.js';

const DEFAULT_MAX_RETRIES = 5;

// ── Helpers ──

function cfg(state, nodeId) {
    const c = state.squad.planConfig?.[nodeId];
    return c || {};
}

function depsMet(s, n) {
    return (n.depends_on || []).every((id) => s.squad.nodes[id]?.status === 'approved');
}

function hasFailedDep(s, n) {
    return (n.depends_on || []).some((id) => {
        const d = s.squad.nodes[id];
        return d && (d.status === 'failed' || d.status === 'blocked' || d.status === 'awaiting_replan');
    });
}

function countLiveSessions(state) {
    let count = 0;
    for (const sess of Object.values(state.sessions)) {
        if (sess.status === 'active' || sess.status === 'creating') {
            count++;
        }
    }
    return count;
}

function nodePhases(nodeId) {
    return nodeId === '__or__' ? ['reviewing'] : ['authoring', 'confirming', 'reviewing'];
}

function nextPhase(node) {
    if (node.status === undefined) return nodePhases(node.id)[0];
    const phases = nodePhases(node.id);
    const idx = phases.indexOf(node.status);
    return idx >= 0 ? (phases[idx + 1] ?? null) : null;
}

// ── Session sub-handlers ──

function handleSessionCreate(state, node) {
    const maxWorkers = state.config?.maxWorkers ?? 3;
    if (countLiveSessions(state) >= maxWorkers) return [];
    const role = node.status;
    const sessionId = sessionIdFor(node.id, role, node.epoch);
    const c = cfg(state, node.id);
    const promptPhase = c.resetOnRej ? 'outer_review' : role;
    return [ac('session:creating', { nodeId: node.id, sessionId, phase: promptPhase, epoch: node.epoch || 0 })];
}

function handleSessionPrompt(state, node, sess) {
    const c = cfg(state, node.id);
    const promptPhase = c.resetOnRej ? 'outer_review' : node.status;
    if (sess.lastPromptedPhase !== promptPhase) {
        return [ac('session:prompting', { nodeId: node.id, sessionId: sess.sessionId, phase: promptPhase })];
    }
    return [];
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

function nodePhaseActions(state, node) {
    const role = node.status;
    const sessionId = sessionIdFor(node.id, role, node.epoch);
    const sess = state.sessions[sessionId];

    if (!sess) return handleSessionCreate(state, node);
    if (sess.status === 'creating') return [];
    if (sess.status === 'faulted') return handleSessionFaulted(state, node, sess);
    // Terminal session states (completed, error, aborted) → treat as no session
    if (sess.status === 'completed' || sess.status === 'error' || sess.status === 'aborted') {
        return handleSessionCreate(state, node);
    }
    return handleSessionPrompt(state, node, sess);
}

// ── Rejected node handler (retry/fail) ──

function handleRejected(state, node) {
    const nextEpoch = (node.epoch || 0) + 1;
    const c = cfg(state, node.id);

    // __or__ rejection is handled by R4 (resets workers), not here
    if (node.id === '__or__') return [];

    if (c.resetOnRej) {
        // 'awaiting_replan' is terminal — R3's when(n.status === 'rejected') won't match,
        // breaking the infinite pulse loop. Outer review rejection replan path
        // (squad:phase_changed) handles the macro-level flow.
        return [ac('squad:node_state', { nodeId: node.id, status: 'awaiting_replan', epoch: node.epoch })];
    }
    if (nextEpoch >= (c.maxRetries || DEFAULT_MAX_RETRIES)) {
        return [ac('squad:node_state', { nodeId: node.id, status: 'failed' })];
    }
    return [
        ac('squad:node_state', {
            nodeId: node.id,
            status: nodePhases(node.id)[0],
            epoch: nextEpoch,
            feedback: node.feedback || '',
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
// Initial wavefront is computed in squad:init projection.
// R2 handles DAG cascade (downstream nodes whose deps become met later).

const RULES = [
    // R1: failed dep → blocked
    {
        when: (s, n) => hasFailedDep(s, n) && n.status !== 'blocked',
        then: (_s, n) => [ac('squad:node_state', { nodeId: n.id, status: 'blocked', summary: 'Blocked by upstream' })],
        perNode: true,
        skip: (_s, n) => n.status === 'blocked',
    },

    // R2: undefined + deps met → first phase (DAG cascade)
    {
        when: (s, n) => n.status === undefined && depsMet(s, n),
        then: (_s, n) => {
            const next = nextPhase(n);
            return next ? [ac('squad:node_state', { nodeId: n.id, status: next })] : [];
        },
        perNode: true,
    },

    // R3: rejected nodes → retry or fail
    {
        when: (_s, n) => n.status === 'rejected' && n.id !== '__or__',
        then: handleRejected,
        perNode: true,
        skip: (_s, n) => n.status !== 'rejected',
    },

    // R4: active phases → manage sessions
    {
        when: (_s, n) => ['authoring', 'confirming', 'reviewing'].includes(n.status),
        then: (state, node) => nodePhaseActions(state, node),
        perNode: true,
    },

    // R5: __or__ rejected → emit squad:phase_changed + squad:force_replan_prompt
    // Outer review failure is a macro-level event, not a micro-level node reset.
    // The entire DAG topology is frozen; the main session must re-plan.
    // This rule fires only once — setting phase to 'revising' prevents re-trigger.
    {
        when: (s) => s.squad.nodes.__or__?.status === 'rejected' && s.squad.phase !== 'revising',
        then: (s) => [
            ac('squad:phase_changed', {
                phase: 'revising',
                feedback: s.squad.nodes.__or__.feedback || 'Outer review rejected the aggregate result',
            }),
            ac('squad:force_replan_prompt', {
                feedback: s.squad.nodes.__or__.feedback || 'Outer review rejected the aggregate result',
            }),
        ],
    },

    // R6: __or__ approved → squad:complete
    {
        when: (s) => s.squad.nodes.__or__?.status === 'approved' && s.squad.status !== 'complete',
        then: (s) => {
            const { workers } = workerStats(s);
            return [
                ac('squad:complete', {
                    results: workers.map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary })),
                }),
            ];
        },
    },

    // R7: M mode — all nodes terminal → squad:complete
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

    // R8: L mode without __or__ — all workers done → squad:complete
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

export function reactState(state) {
    if (state.squad.status !== 'active') return [];
    // Revising phase freezes the DAG — the Architect is thinking. No actions until replan.
    if (state.squad.phase === 'revising') return [];
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
