/**
 * Rule-based Reactor — f(state) → Action[].
 *
 * No switch/case, no special outer-review path.
 * Every node (including __or__) is a generic TaskNode with
 * phases[], maxRetries, and resetDependentsOnRejection.
 * Reactor = flat rule table + flatMap.
 */
import { sessionIdFor } from '../shared/events.js';

const DEFAULT_MAX_RETRIES = 5;

// ── Pure Helpers ──

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
        if (node.status === sess.phase && node.retryCount === sess.retryCount) c++;
    }
    return c;
}

/** Next lifecycle phase from node.phases array. */
function nextPhase(node) {
    const phases = node.phases || ['authoring', 'confirming', 'reviewing'];
    if (node.status === 'idle') return phases[0];
    const idx = phases.indexOf(node.status);
    return idx >= 0 ? (phases[idx + 1] ?? null) : null;
}

// ── Sub-handlers for nodePhaseActions ──

function handleSessionReturn(state, node, sess) {
    const p = sess.latestReturn;
    const rc = (node.retryCount || 0) + 1;

    // Reviewing return: ok → approved, else → retry/fail
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
        // Node with resetDependentsOnRejection → 'rejected' (triggers R5)
        if (node.resetDependentsOnRejection) {
            return [
                ac('squad:node_state', {
                    nodeId: node.id,
                    status: 'rejected',
                    round: rc,
                    feedback: p.reason || '',
                }),
            ];
        }
        // Regular worker: exceed maxRetries → fail, else retry first phase
        if (rc >= (node.maxRetries || DEFAULT_MAX_RETRIES)) {
            return [ac('squad:node_state', { nodeId: node.id, status: 'failed' })];
        }
        const firstPhase = node.phases?.[0] || 'authoring';
        return [
            ac('squad:node_state', {
                nodeId: node.id,
                status: firstPhase,
                retryCount: rc,
                feedback: p.reason,
            }),
        ];
    }

    // Authoring/confirming: any return advances to next phase
    const next = nextPhase(node);
    return next ? [ac('squad:node_state', { nodeId: node.id, status: next })] : [];
}

function handleSessionPrompt(node, sess) {
    const promptPhase = node.resetDependentsOnRejection ? 'outer_review' : node.status;
    if (sess.lastPromptedPhase !== promptPhase) {
        return [
            ac('session:prompting', {
                nodeId: node.id,
                sessionId: sess.sessionId,
                phase: promptPhase,
            }),
        ];
    }
    return [];
}

function handleSessionCreate(state, node) {
    const maxWorkers = state.modelPool.maxWorkers || 3;
    if (countLiveSessions(state) >= maxWorkers) return [];
    const role = node.status;
    const sessionId = sessionIdFor(node.id, role, node.retryCount);
    const promptPhase = node.resetDependentsOnRejection ? 'outer_review' : role;
    return [
        ac('session:creating', {
            nodeId: node.id,
            sessionId,
            phase: promptPhase,
            retryCount: node.retryCount || 0,
        }),
    ];
}

function nodePhaseActions(state, node) {
    const role = node.status;
    const sessionId = sessionIdFor(node.id, role, node.retryCount);
    const sess = state.sessions[sessionId];

    if (!sess) return handleSessionCreate(state, node);
    if (sess.status === 'creating') return [];
    if (sess.latestReturn) return handleSessionReturn(state, node, sess);
    return handleSessionPrompt(node, sess);
}

function workerStats(state) {
    const workers = Object.values(state.squad.nodes).filter((n) => !n.resetDependentsOnRejection);
    const allDone =
        workers.length > 0 &&
        workers.every((n) => n.status === 'approved' || n.status === 'failed' || n.status === 'blocked');
    return { workers, allDone };
}

// ── Rule table ──

const RULES = [
    // R1: undefined → idle
    {
        when: (_s, n) => n.status === undefined,
        then: (_s, n) => [ac('squad:node_state', { nodeId: n.id, status: 'idle' })],
        perNode: true,
    },

    // R2: failed dep → blocked
    {
        when: (s, n) => hasFailedDep(s, n) && n.status !== 'blocked',
        then: (_s, n) => [ac('squad:node_state', { nodeId: n.id, status: 'blocked', summary: 'Blocked by upstream' })],
        perNode: true,
        skip: (_s, n) => n.status === 'blocked',
    },

    // R3: idle + deps met → next phase
    {
        when: (s, n) => n.status === 'idle' && depsMet(s, n),
        then: (_s, n) => {
            const next = nextPhase(n);
            return next ? [ac('squad:node_state', { nodeId: n.id, status: next })] : [];
        },
        perNode: true,
    },

    // R4: active phases → manage sessions
    {
        when: (_s, n) => ['authoring', 'confirming', 'reviewing'].includes(n.status),
        then: (state, node) => nodePhaseActions(state, node),
        perNode: true,
    },

    // R5: node with resetDependentsOnRejection rejected → reset all approved workers
    {
        when: (s) => Object.values(s.squad.nodes).some((n) => n.resetDependentsOnRejection && n.status === 'rejected'),
        then: (s) => {
            const actions = [];
            const rejectedNode = Object.values(s.squad.nodes).find(
                (n) => n.resetDependentsOnRejection && n.status === 'rejected',
            );
            const feedback = rejectedNode?.feedback || 'Rejected';

            for (const node of Object.values(s.squad.nodes)) {
                if (node.resetDependentsOnRejection) continue;
                if (node.status === 'approved') {
                    actions.push(
                        ac('squad:node_state', {
                            nodeId: node.id,
                            status: 'authoring',
                            retryCount: (node.retryCount || 0) + 1,
                            feedback,
                        }),
                    );
                }
            }
            const orRetry = (rejectedNode?.retryCount || 0) + 1;
            actions.push(
                ac('squad:node_state', {
                    nodeId: rejectedNode.id,
                    status: 'idle',
                    retryCount: orRetry,
                }),
            );
            return actions;
        },
    },

    // R6: __or__ (resetDependentsOnRejection) approved → squad:complete
    {
        when: (s) => {
            const or = s.squad.nodes.__or__;
            return or?.status === 'approved' && s.squad.status !== 'complete';
        },
        then: (s) => {
            const { workers } = workerStats(s);
            return [
                ac('squad:complete', {
                    results: workers.map((n) => ({
                        nodeId: n.id,
                        status: n.status,
                        summary: n.summary,
                    })),
                }),
            ];
        },
    },

    // R7: M mode — all nodes ready → squad:complete
    {
        when: (s) =>
            s.squad.mode !== 'L' &&
            (() => {
                const nodes = Object.values(s.squad.nodes);
                return (
                    nodes.length > 0 &&
                    nodes.every((n) => n.status === 'approved' || n.status === 'failed' || n.status === 'blocked')
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

    // R8: L mode without __or__ (all workers done) → squad:complete
    {
        when: (s) =>
            s.squad.mode === 'L' &&
            !s.squad.nodes.__or__ &&
            (() => {
                const { allDone } = workerStats(s);
                return allDone;
            })(),
        then: (s) => {
            const { workers } = workerStats(s);
            return [
                ac('squad:complete', {
                    results: workers.map((n) => ({
                        nodeId: n.id,
                        status: n.status,
                        summary: n.summary,
                    })),
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
