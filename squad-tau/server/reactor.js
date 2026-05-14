/**
 * Stateless Reactor (v4 — Pure Fact Emission, No Model Pool).
 *
 * f(state) → Action[].
 *
 * Key changes from v3:
 *   - No model pool acquire/release lifecycle (Cut 1: Slotless)
 *   - Deterministic URN session IDs (Cut 2)
 *   - Flat key-value state maps, no .find() traversals (Cut 4)
 *   - Config-driven concurrency from state.modelPool.maxWorkers
 */
import { Events, sessionIdFor } from '../shared/events.js';
import { STATUS, DEFAULTS } from './constants.js';

export function reactState(state) {
    const actions = [];
    if (state.squad.status !== 'active') return [];

    const nodes = state.squad.nodes;
    const allNodes = Object.values(nodes);

    // ── 0. Initial status: undefined → idle ──
    const pendingInit = allNodes.filter((n) => n.status === undefined);
    if (pendingInit.length > 0) {
        return pendingInit.map((n) => ({
            type: Events.SQUAD_NODE_STATE,
            payload: { nodeId: n.id, status: 'idle' },
        }));
    }

    // ── 1. Outer Review Gate ──
    const completed = allNodes.filter((n) => n.status === STATUS.APPROVED);
    const failed = allNodes.filter((n) => n.status === STATUS.FAILED || n.status === STATUS.BLOCKED);
    const hasActive = allNodes.some((n) => !['approved', 'failed', 'blocked', undefined].includes(n.status));

    if (!hasActive && allNodes.length > 0) {
        const allDone = completed.length + failed.length === allNodes.length;

        if (allDone && completed.length === allNodes.length) {
            const or = state.squad.outerReview;
            if (or?.status === 'approved') {
                if (state.squad.status !== 'complete') {
                    actions.push({
                        type: Events.SQUAD_COMPLETE,
                        payload: {
                            results: allNodes.map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary })),
                        },
                    });
                }
            } else if (or?.status === 'rejected') {
                const anyReset = allNodes.some((n) => (n.retryCount || 0) > 0);
                if (anyReset) {
                    actions.push({ type: Events.SQUAD_OUTER_REVIEW_START, payload: { round: (or?.round || 0) + 1 } });
                } else {
                    const reason = or?.feedback || 'Outer review rejected';
                    for (const node of completed) {
                        actions.push({
                            type: Events.SQUAD_NODE_STATE,
                            payload: {
                                nodeId: node.id,
                                status: STATUS.AUTHORING,
                                retryCount: (node.retryCount || 0) + 1,
                                feedback: reason,
                            },
                        });
                    }
                }
            } else if (or?.status === 'pending') {
                handleOuterReviewPhase(state, actions);
            } else {
                actions.push({ type: Events.SQUAD_OUTER_REVIEW_START, payload: { round: 1 } });
            }
        } else if (allDone && completed.length + failed.length === allNodes.length) {
            if (state.squad.status !== 'complete') {
                actions.push({
                    type: Events.SQUAD_COMPLETE,
                    payload: { results: allNodes.map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary })) },
                });
            }
        }
    }

    // ── 2. Node State Machine ──
    for (const node of allNodes) {
        if (['approved', 'failed', 'blocked'].includes(node.status)) continue;

        const deps = node.depends_on || [];
        const blocking = deps.find((id) => {
            const d = nodes[id];
            return d && ['failed', 'blocked'].includes(d.status);
        });
        if (blocking) {
            if (node.status !== STATUS.BLOCKED) {
                actions.push({
                    type: Events.SQUAD_NODE_STATE,
                    payload: { nodeId: node.id, status: STATUS.BLOCKED, summary: 'Blocked by upstream' },
                });
            }
            continue;
        }

        const depsMet = deps.every((id) => {
            const d = nodes[id];
            return d && d.status === STATUS.APPROVED;
        });
        if (!depsMet && node.status !== 'idle') continue;

        switch (node.status) {
            case 'idle':
                if (depsMet)
                    actions.push({
                        type: Events.SQUAD_NODE_STATE,
                        payload: { nodeId: node.id, status: STATUS.AUTHORING },
                    });
                break;
            case STATUS.AUTHORING:
                handlePhase(node, 'authoring', state, actions);
                break;
            case STATUS.CONFIRMING:
                handlePhase(node, 'confirming', state, actions);
                break;
            case STATUS.REVIEWING:
                handlePhase(node, 'reviewing', state, actions);
                break;
        }
    }

    return actions;
}

function handlePhase(node, role, state, actions) {
    const sessionId = sessionIdFor(node.id, role, node.retryCount);
    const sess = state.sessions[sessionId];

    if (sess) {
        if (sess.status === 'creating') return;

        if (sess.latestReturn) {
            const p = sess.latestReturn;
            if (role === 'reviewing') {
                if (p.status === 'ok') {
                    actions.push({
                        type: Events.SQUAD_NODE_STATE,
                        payload: {
                            nodeId: node.id,
                            status: STATUS.APPROVED,
                            summary: p.reason,
                            affectedFiles: p.affected_files,
                        },
                    });
                } else {
                    const rc = (node.retryCount || 0) + 1;
                    if (rc >= DEFAULTS.MAX_RETRIES) {
                        actions.push({
                            type: Events.SQUAD_NODE_STATE,
                            payload: { nodeId: node.id, status: STATUS.FAILED },
                        });
                    } else {
                        actions.push({
                            type: Events.SQUAD_NODE_STATE,
                            payload: { nodeId: node.id, status: STATUS.AUTHORING, retryCount: rc, feedback: p.reason },
                        });
                    }
                }
            } else {
                const next = role === 'authoring' ? STATUS.CONFIRMING : STATUS.REVIEWING;
                actions.push({ type: Events.SQUAD_NODE_STATE, payload: { nodeId: node.id, status: next } });
            }
            return;
        }

        if (sess.lastPromptedPhase !== role) {
            actions.push({ type: Events.SESSION_PROMPTING, payload: { nodeId: node.id, sessionId, phase: role } });
        }
        return;
    }

    const maxWorkers = state.modelPool.maxWorkers || 3;
    if (countLiveSessions(state) < maxWorkers) {
        actions.push({
            type: Events.SESSION_CREATING,
            payload: { nodeId: node.id, sessionId, phase: role, retryCount: node.retryCount || 0 },
        });
    }
}

function handleOuterReviewPhase(state, actions) {
    const round = state.squad.outerReview?.round || 1;
    const sessionId = sessionIdFor('or', 'outer_review', round);
    const sess = state.sessions[sessionId];

    if (sess) {
        if (sess.status === 'creating') return;

        if (sess.latestReturn) {
            const p = sess.latestReturn;
            const ok = p.status === 'ok';
            actions.push({
                type: ok ? Events.SQUAD_OUTER_REVIEW_DONE : Events.SQUAD_OUTER_REVIEW_FAILED,
                payload: { reason: p.reason || '' },
            });
            actions.push({ type: Events.SESSION_END, payload: { sessionId, reason: ok ? 'completed' : 'error' } });
            return;
        }

        if (state.squad.outerReview && !state.squad.outerReview.lastPrompted) {
            actions.push({ type: Events.SESSION_PROMPTING, payload: { phase: 'outer_review', sessionId } });
        }
        return;
    }

    const maxWorkers = state.modelPool.maxWorkers || 3;
    if (countLiveSessions(state) < maxWorkers) {
        actions.push({
            type: Events.SESSION_CREATING,
            payload: { nodeId: null, sessionId, phase: 'outer_review', retryCount: 0 },
        });
    }
}

function countLiveSessions(state) {
    let count = 0;
    for (const sess of Object.values(state.sessions)) {
        if (sess.status !== 'active' && sess.status !== 'creating') continue;
        if (!sess.nodeId) {
            count++;
            continue;
        }
        const node = state.squad.nodes[sess.nodeId];
        if (!node) continue;
        const parts = sess.sessionId.split('::');
        const retry = parts.length === 3 ? parseInt(parts[2], 10) : -1;
        if (node.status === sess.phase && node.retryCount === retry) count++;
    }
    return count;
}
