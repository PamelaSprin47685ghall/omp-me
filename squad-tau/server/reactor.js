/**
 * Stateless Reactor (v3 — Pure Fact Emission).
 *
 * f(state) → Action[].
 *
 * No log scans, no isFulfilled, no nodeHistory, no hasPendingCommand.
 * No CMD_ events — only facts. Every output is directly appended to EventLog.
 * Side-effects subscribe to the log and react to facts they care about.
 *
 * Composable sub-reactors:
 *   - initialStatus transitions (undefined → idle)
 *   - modelRelease (terminal nodes → MODEL_POOL_RELEASE)
 *   - outerReviewGate (all APPROVED → outer review → SQUAD_COMPLETE)
 *   - nodeFSM (per-node state machine)
 */
import { Events } from '../shared/events.js';
import { STATUS, DEFAULTS } from './constants.js';

/**
 * Pure state-based reactor.
 * f(state) → Action[]. No log scans, no traversals.
 *
 * @param {Object} state  — fully projected state (from project() or incremental fold)
 * @returns {Array<{type, payload}>}
 */
export function reactState(state) {
    const actions = [];

    if (state.squad.status !== 'active') return [];

    // ── 0. Initial status: undefined → idle ──
    const pendingInit = state.squad.nodes.filter((n) => n.status === undefined);
    if (pendingInit.length > 0) {
        return pendingInit.map((n) => ({
            type: Events.SQUAD_NODE_STATE,
            payload: { nodeId: n.id, status: 'idle' },
        }));
    }

    // ── 1. Model Release Rule ──
    for (const [slotId, usage] of Object.entries(state.modelPool.usage)) {
        if (usage.nodeId === undefined && usage.role === 'reviewer') {
            // Outer review model — release after outer review terminal
            if (state.squad.outerReview?.status === 'approved' || state.squad.outerReview?.status === 'rejected') {
                actions.push({ type: Events.MODEL_POOL_RELEASE, payload: { slotId } });
            }
            continue;
        }

        const node = state.squad.nodes.find((n) => n.id === usage.nodeId);
        if (!node || [STATUS.APPROVED, STATUS.FAILED, STATUS.BLOCKED].includes(node.status)) {
            actions.push({ type: Events.MODEL_POOL_RELEASE, payload: { slotId } });
        }
    }

    // ── 2. Outer Review Gate ──
    const allNodes = state.squad.nodes;
    const completedNodes = allNodes.filter((n) => n.status === STATUS.APPROVED);
    const failedNodes = allNodes.filter((n) => n.status === STATUS.FAILED || n.status === STATUS.BLOCKED);

    if (completedNodes.length === allNodes.length && allNodes.length > 0) {
        const orStatus = state.squad.outerReview?.status;

        if (orStatus === 'approved') {
            if (state.squad.status !== 'complete') {
                actions.push({
                    type: Events.SQUAD_COMPLETE,
                    payload: { results: allNodes.map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary })) },
                });
            }
        } else if (orStatus === 'rejected') {
            const anyReset = allNodes.some((n) => (n.retryCount || 0) > 0);
            if (anyReset) {
                const lastO = state.squad.outerReview;
                const round = (lastO?.round || 0) + 1;
                actions.push({ type: Events.SQUAD_OUTER_REVIEW_START, payload: { round } });
            } else {
                const failReason = state.squad.outerReview?.feedback || 'Outer review rejected';
                for (const node of allNodes) {
                    if (node.status === STATUS.APPROVED) {
                        actions.push({
                            type: Events.SQUAD_NODE_STATE,
                            payload: {
                                nodeId: node.id,
                                status: STATUS.AUTHORING,
                                retryCount: (node.retryCount || 0) + 1,
                                feedback: failReason,
                            },
                        });
                    }
                }
            }
        } else if (orStatus === 'pending') {
            handleOuterReviewPhase(state, actions);
        } else {
            actions.push({ type: Events.SQUAD_OUTER_REVIEW_START, payload: { round: 1 } });
        }
    } else if (completedNodes.length + failedNodes.length === allNodes.length && allNodes.length > 0) {
        if (state.squad.status !== 'complete') {
            actions.push({
                type: Events.SQUAD_COMPLETE,
                payload: { results: allNodes.map((n) => ({ nodeId: n.id, status: n.status, summary: n.summary })) },
            });
        }
    }

    // ── 3. Node State Machine ──
    for (const node of allNodes) {
        if (node.status === STATUS.APPROVED || node.status === STATUS.FAILED || node.status === STATUS.BLOCKED)
            continue;

        const deps = node.depends_on || [];
        const depResults = deps.map((id) => allNodes.find((n) => n.id === id));
        const blockingDep = depResults.find((d) => d.status === STATUS.FAILED || d.status === STATUS.BLOCKED);
        if (blockingDep) {
            if (node.status !== STATUS.BLOCKED) {
                actions.push({
                    type: Events.SQUAD_NODE_STATE,
                    payload: { nodeId: node.id, status: STATUS.BLOCKED, summary: 'Blocked by upstream' },
                });
            }
            continue;
        }

        const depsMet = depResults.every((d) => d.status === STATUS.APPROVED);
        if (!depsMet && node.status !== 'idle') continue;

        switch (node.status) {
            case 'idle':
                if (depsMet) {
                    actions.push({
                        type: Events.SQUAD_NODE_STATE,
                        payload: { nodeId: node.id, status: STATUS.AUTHORING },
                    });
                }
                break;

            case STATUS.AUTHORING:
                handlePhase(node, 'worker', 'authoring', state, actions);
                break;

            case STATUS.CONFIRMING:
                handlePhase(node, 'worker_confirm', 'confirming', state, actions);
                break;

            case STATUS.REVIEWING:
                handlePhase(node, 'reviewer', 'reviewer', state, actions);
                break;
        }
    }

    return actions;
}

/**
 * Handle one phase of a node's state machine.
 *
 * Pure O(1) decisions — no array traversals, no message scanning.
 * The `session.latestReturn` projection handles return extraction.
 * Active session determined by single `activeSessionId` cursor.
 */
function handlePhase(node, role, promptPhase, state, actions) {
    const sessionId = node.activeSessionId;
    const hasActiveSession = sessionId && node.activePhase === role && state.sessions[sessionId];

    if (hasActiveSession) {
        const sess = state.sessions[sessionId];

        // O(1) return check — projected by SESSION_TOOL_CALL handler
        if (sess.latestReturn) {
            const params = sess.latestReturn;

            if (role === 'reviewer') {
                if (params.status === 'ok') {
                    actions.push({
                        type: Events.SQUAD_NODE_STATE,
                        payload: {
                            nodeId: node.id,
                            status: STATUS.APPROVED,
                            summary: params.reason,
                            affectedFiles: params.affected_files,
                        },
                    });
                } else {
                    const retryCount = (node.retryCount || 0) + 1;
                    if (retryCount >= DEFAULTS.MAX_RETRIES) {
                        actions.push({
                            type: Events.SQUAD_NODE_STATE,
                            payload: { nodeId: node.id, status: STATUS.FAILED },
                        });
                    } else {
                        actions.push({
                            type: Events.SQUAD_NODE_STATE,
                            payload: {
                                nodeId: node.id,
                                status: STATUS.AUTHORING,
                                retryCount,
                                feedback: params.reason,
                            },
                        });
                    }
                }
            } else {
                // worker or worker_confirm return → advance to next phase
                const nextStatus = role === 'worker' ? STATUS.CONFIRMING : STATUS.REVIEWING;
                actions.push({
                    type: Events.SQUAD_NODE_STATE,
                    payload: { nodeId: node.id, status: nextStatus },
                });
            }
            return;
        }

        // No return yet — check if we need to prompt
        if (node.sessionStatus !== 'prompting' && node.lastPromptedPhase !== promptPhase) {
            actions.push({
                type: Events.SESSION_PROMPTING,
                payload: { nodeId: node.id, sessionId, phase: promptPhase },
            });
        }
        return;
    }

    // No active session for this phase
    if (node.sessionStatus === 'creating') return;

    // Need model or session
    const acquireRole = role.startsWith('worker') ? 'worker' : 'reviewer';
    const hasSlot = Object.values(state.modelPool.usage).some((u) => u.nodeId === node.id && u.role === acquireRole);

    if (hasSlot) {
        // Model acquired but no session yet → emit SESSION_CREATING
        const slotEntry = Object.entries(state.modelPool.usage).find(
            ([, u]) => u.nodeId === node.id && u.role === acquireRole,
        );
        actions.push({
            type: Events.SESSION_CREATING,
            payload: { nodeId: node.id, phase: role, slotId: slotEntry[0] },
        });
    } else {
        const roleSlots = state.modelPool.slots.filter((s) => s.role === acquireRole);
        if (roleSlots.length === 0) {
            // No slots configured → create session directly
            actions.push({
                type: Events.SESSION_CREATING,
                payload: { nodeId: node.id, phase: role },
            });
        } else {
            const freeSlot = roleSlots.find(
                (s) =>
                    !state.modelPool.usage[s.slotId] &&
                    !actions.some((a) => a.type === Events.MODEL_POOL_ACQUIRE && a.payload.slotId === s.slotId),
            );
            if (freeSlot) {
                actions.push({
                    type: Events.MODEL_POOL_ACQUIRE,
                    payload: { slotId: freeSlot.slotId, nodeId: node.id, role: acquireRole },
                });
            }
        }
    }
}

/**
 * Outer Review Phase Handler.
 */
function handleOuterReviewPhase(state, actions) {
    const session = Object.values(state.sessions).find((s) => s.role === 'outer_review' && s.status === 'active');

    if (!session) {
        const hasORSlot = Object.values(state.modelPool.usage).some(
            (u) => u.nodeId === undefined && u.role === 'reviewer',
        );

        if (hasORSlot) {
            const slotEntry = Object.entries(state.modelPool.usage).find(
                ([, u]) => u.nodeId === undefined && u.role === 'reviewer',
            );
            actions.push({
                type: Events.SESSION_CREATING,
                payload: { phase: 'outer_review', slotId: slotEntry[0] },
            });
        } else {
            const reviewSlots = state.modelPool.slots.filter((s) => s.role === 'reviewer');
            if (reviewSlots.length === 0) {
                actions.push({
                    type: Events.SESSION_CREATING,
                    payload: { phase: 'outer_review' },
                });
            } else {
                const freeSlot = reviewSlots.find(
                    (s) =>
                        !state.modelPool.usage[s.slotId] &&
                        !actions.some((a) => a.type === Events.MODEL_POOL_ACQUIRE && a.payload.slotId === s.slotId),
                );
                if (freeSlot) {
                    actions.push({
                        type: Events.MODEL_POOL_ACQUIRE,
                        payload: { slotId: freeSlot.slotId, role: 'reviewer' },
                    });
                }
            }
        }
        return;
    }

    // O(1) return check via latestReturn projection
    if (session.latestReturn) {
        const params = session.latestReturn;
        const isOk = params.status === 'ok';

        actions.push({
            type: isOk ? Events.SQUAD_OUTER_REVIEW_DONE : Events.SQUAD_OUTER_REVIEW_FAILED,
            payload: { reason: params.reason || '' },
        });
        actions.push({
            type: Events.SESSION_END,
            payload: { sessionId: session.sessionId, reason: isOk ? 'completed' : 'error' },
        });
        return;
    }

    // Check if we already prompted this round
    const orState = state.squad.outerReview;
    if (orState && orState.round > 0 && !orState.lastPrompted) {
        actions.push({
            type: Events.SESSION_PROMPTING,
            payload: { phase: 'outer_review', sessionId: session.sessionId },
        });
    }
}
