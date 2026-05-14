/**
 * Stateless Reactor Engine (v2 — Pure State Query).
 *
 * f(state) → Action[]
 *
 * No log scans, no isFulfilled, no nodeHistory, no hasPendingCommand.
 * All decisions derived from the projected State tree.
 *
 * Composable sub-reactors:
 *   - initialStatus transitions (undefined → idle)
 *   - modelRelease (terminal nodes → CMD_RELEASE_MODEL)
 *   - outerReviewGate (all APPROVED → outer review → SQUAD_COMPLETE)
 *   - nodeFSM (per-node state machine: idle → authoring → confirming → reviewing → approved)
 */
import { Events } from '../shared/events.js';
import { STATUS, DEFAULTS } from './constants.js';

/**
 * Pure state-based reactor.
 * f(state) → Action[]. No log scans, no isFulfilled, no nodeHistory.
 * All decisions derived from the projected State tree.
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

    // ── 1. Model Release Rule (state-based) ──
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
            // Check if any node was already reset (if retryCount > 0, reset happened)
            const anyReset = allNodes.some((n) => (n.retryCount || 0) > 0);
            if (anyReset) {
                // Nodes were reset and may be re-approved — start new outer review round
                const lastO = state.squad.outerReview;
                const round = (lastO?.round || 0) + 1;
                actions.push({ type: Events.SQUAD_OUTER_REVIEW_START, payload: { round } });
            } else {
                // First failure — reset nodes back to AUTHORING
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
            // INITIAL
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

        // Dependency check
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

        // ── State Transitions ──
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
                handlePhase(node, 'worker', 'authoring', 'authoringSessionId', state, actions);
                break;

            case STATUS.CONFIRMING:
                handlePhase(node, 'worker_confirm', 'confirming', 'confirmingSessionId', state, actions);
                break;

            case STATUS.REVIEWING:
                handlePhase(node, 'reviewer', 'reviewer', 'reviewerSessionId', state, actions);
                break;
        }
    }

    return actions;
}

/**
 * Handle one phase of a node's state machine.
 *
 * State-based version — no log queries, no nodeHistory.
 * Pure: (node + state) → actions[]
 */
function handlePhase(node, role, promptPhase, sessionField, state, actions) {
    const sessionId = node[sessionField];

    // Check if the LLM already returned (tool_call 'return' present)
    if (sessionId && state.sessions[sessionId]) {
        const sess = state.sessions[sessionId];
        // Find the LATEST return tool call (messages are pushed in order)
        const retCall = [...sess.messages]
            .reverse()
            .find((m) => m.content?.some((c) => c.type === 'tool_call' && c.toolName === 'return'));
        if (retCall) {
            const retPayload = retCall.content.find((c) => c.type === 'tool_call');
            const params = retPayload?.params || { status: 'ok', reason: 'auto' };

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
    }

    // No return yet — check if we need to acquire model, create session, or prompt
    if (!sessionId || !state.sessions[sessionId]) {
        // Need model or session
        if (node.sessionStatus === 'creating') return; // session creation in flight

        // Check if model already acquired for this node/role combo
        const acquireRole = role.startsWith('worker') ? 'worker' : 'reviewer';
        const hasSlot = Object.values(state.modelPool.usage).some(
            (u) => u.nodeId === node.id && u.role === acquireRole,
        );

        if (hasSlot) {
            // Model acquired but no session yet → emit CMD_CREATE_SESSION
            const slotEntry = Object.entries(state.modelPool.usage).find(
                ([, u]) => u.nodeId === node.id && u.role === acquireRole,
            );
            actions.push({
                type: Events.CMD_CREATE_SESSION,
                payload: { nodeId: node.id, phase: role, slotId: slotEntry[0] },
            });
        } else {
            const roleSlots = state.modelPool.slots.filter((s) => s.role === acquireRole);
            if (roleSlots.length === 0) {
                // No slots configured → skip acquisition, create session directly
                actions.push({
                    type: Events.CMD_CREATE_SESSION,
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
        return;
    }

    // Session exists and active → send prompt if not already sent
    if (node.sessionStatus !== 'prompting' && (!node.lastPromptedPhase || node.lastPromptedPhase !== promptPhase)) {
        actions.push({
            type: Events.CMD_PROMPT,
            payload: { nodeId: node.id, sessionId, phase: promptPhase },
        });
    }
}

/**
 * Outer Review Phase Handler (state-based).
 */
function handleOuterReviewPhase(state, actions) {
    const session = Object.values(state.sessions).find((s) => s.role === 'outer_review' && s.status === 'active');

    if (!session) {
        // Check for existing model acquisition
        const hasORSlot = Object.values(state.modelPool.usage).some(
            (u) => u.nodeId === undefined && u.role === 'reviewer',
        );

        if (hasORSlot) {
            const slotEntry = Object.entries(state.modelPool.usage).find(
                ([, u]) => u.nodeId === undefined && u.role === 'reviewer',
            );
            actions.push({
                type: Events.CMD_CREATE_SESSION,
                payload: { phase: 'outer_review', slotId: slotEntry[0] },
            });
        } else {
            const reviewSlots = state.modelPool.slots.filter((s) => s.role === 'reviewer');
            if (reviewSlots.length === 0) {
                // No reviewer slots → create session without model assignment
                actions.push({
                    type: Events.CMD_CREATE_SESSION,
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

    // Session exists — check for return tool call (find LATEST)
    const retCall = [...session.messages]
        .reverse()
        .find((m) => m.content?.some((c) => c.type === 'tool_call' && c.toolName === 'return'));
    if (retCall) {
        const retPayload = retCall.content.find((c) => c.type === 'tool_call');
        const params = retPayload?.params || {};
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

    // Prompt not yet sent — check if we already prompted this round
    const orState = state.squad.outerReview;
    if (orState && orState.round > 0 && !orState.lastPrompted) {
        actions.push({
            type: Events.CMD_PROMPT,
            payload: { phase: 'outer_review', sessionId: session.sessionId },
        });
    }
}
