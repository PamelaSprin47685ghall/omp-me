/**
 * Homomorphic event projections — shared between client and server.
 *
 * Two modes:
 *   1. `project(log)` — full scan from scratch (for cold start)
 *   2. `applyEvent(state, entry)` — incremental fold (for live updates)
 *
 * Both produce identical results for the same event sequence.
 * `fold(state, entry)` is the pure reducer: (prevState, event) -> nextState.
 * `project` is the multi-event convenience wrapper.
 */
import { Events } from './events.js';

export function getInitialState() {
    return {
        squad: {
            status: 'idle',
            nodes: [],
            results: [],
            originalTask: '',
        },
        sessions: {},
        modelPool: {
            slots: [],
            usage: {},
        },
    };
}

/**
 * Incremental fold: apply one event to existing state (mutates in place).
 * For the imperative engine loop — O(1) per event.
 */
export function applyEvent(state, type, payload) {
    switch (type) {
        case Events.SQUAD_INIT:
            state.squad = {
                ...state.squad,
                ...payload,
                nodes: payload.nodes
                    ? payload.nodes.map((n) => ({
                          ...n,
                          // Expanded node fields for Reactor fast-path (Phase 1: no behavior change)
                          authoringSessionId: null,
                          confirmingSessionId: null,
                          reviewerSessionId: null,
                          sessionStatus: 'none',
                          waitingForModel: null,
                      }))
                    : [],
                status: 'active',
            };
            break;
        case Events.SQUAD_NODE_STATE:
            {
                const node = state.squad.nodes.find((n) => n.id === payload.nodeId);
                if (node) {
                    Object.assign(node, payload);
                    // Retry: clear stale session references so reactor starts fresh
                    if (payload.status === 'authoring' && (payload.retryCount || 0) > 0) {
                        node.authoringSessionId = null;
                        node.confirmingSessionId = null;
                        node.reviewerSessionId = null;
                        node.sessionStatus = 'none';
                        node.lastPromptedPhase = null;
                        node.waitingForModel = null;
                    }
                    // Terminal or moving to next phase: clear model wait
                    if (['approved', 'failed', 'blocked'].includes(payload.status)) {
                        node.waitingForModel = null;
                    }
                }
            }
            break;
        case Events.SQUAD_COMPLETE:
            state.squad.status = 'complete';
            state.squad.results = payload.results;
            break;
        case Events.SQUAD_ABORT:
            state.squad.status = 'aborted';
            break;
        case Events.SQUAD_OUTER_REVIEW_START:
            state.squad.outerReview = { status: 'pending', round: payload.round || 1 };
            break;
        case Events.SQUAD_OUTER_REVIEW_DONE:
            if (state.squad.outerReview) state.squad.outerReview.status = 'approved';
            break;
        case Events.SQUAD_OUTER_REVIEW_FAILED:
            state.squad.outerReview = {
                status: 'rejected',
                round: state.squad.outerReview?.round || 1,
                feedback: payload.reason,
            };
            break;

        case Events.SESSION_START:
            state.sessions[payload.sessionId] = {
                ...payload,
                role: payload.phase,
                status: 'active',
                messages: [],
            };
            // Reverse-write sessionId into node's phase field for Reactor fast-path
            if (payload.nodeId) {
                const node = state.squad.nodes.find((n) => n.id === payload.nodeId);
                if (node) {
                    const phaseField = {
                        worker: 'authoringSessionId',
                        worker_confirm: 'confirmingSessionId',
                        reviewer: 'reviewerSessionId',
                        outer_review: 'outerReviewSessionId',
                    }[payload.phase];
                    if (phaseField) node[phaseField] = payload.sessionId;
                    node.sessionStatus = 'active';
                }
            }
            break;

        case Events.SESSION_CREATING:
            if (payload.nodeId) {
                const node = state.squad.nodes.find((n) => n.id === payload.nodeId);
                if (node) node.sessionStatus = 'creating';
            }
            break;

        case Events.SESSION_PROMPTING:
            if (payload.sessionId) {
                const sess = state.sessions[payload.sessionId];
                if (sess) {
                    if (sess.role === 'outer_review' && state.squad.outerReview) {
                        state.squad.outerReview.lastPrompted = true;
                    }
                    const node = state.squad.nodes.find((n) => n.id === sess.nodeId);
                    if (node) {
                        node.sessionStatus = 'prompting';
                        node.lastPromptedPhase = payload.phase;
                    }
                }
            }
            break;

        case Events.NODE_WAITING_FOR_MODEL:
            {
                const node = state.squad.nodes.find((n) => n.id === payload.nodeId);
                if (node) node.waitingForModel = payload.role;
            }
            break;

        case Events.MODEL_ASSIGNED:
            state.modelPool.usage[payload.slotId] = {
                inUse: true,
                holder: payload.sessionId || payload.nodeId,
                nodeId: payload.nodeId,
                role: payload.role,
            };
            // SideEffect succeeded: clear the waiting flag so Reactor won't re-emit
            if (payload.nodeId) {
                const node = state.squad.nodes.find((n) => n.id === payload.nodeId);
                if (node) node.waitingForModel = null;
            }
            break;
        case Events.SESSION_STATE:
            if (state.sessions[payload.sessionId]) {
                const sess = state.sessions[payload.sessionId];
                sess.phase = payload.phase;
                sess.status = ['completed', 'aborted', 'error'].includes(payload.phase) ? payload.phase : 'active';
            }
            break;
        case Events.SESSION_END:
            if (state.sessions[payload.sessionId]) {
                state.sessions[payload.sessionId].status = payload.reason;
                state.sessions[payload.sessionId].errorMessage = payload.errorMessage;
            }
            // Clear reverse-written node fields so Reactor knows session is gone
            for (const node of state.squad.nodes) {
                if (node.authoringSessionId === payload.sessionId) {
                    node.authoringSessionId = null;
                    node.sessionStatus = 'none';
                }
                if (node.confirmingSessionId === payload.sessionId) {
                    node.confirmingSessionId = null;
                    node.sessionStatus = 'none';
                }
                if (node.reviewerSessionId === payload.sessionId) {
                    node.reviewerSessionId = null;
                    node.sessionStatus = 'none';
                }
                if (node.outerReviewSessionId === payload.sessionId) {
                    node.outerReviewSessionId = null;
                    node.sessionStatus = 'none';
                }
            }
            break;
        case Events.SESSION_MESSAGE:
            if (state.sessions[payload.sessionId]) {
                const list = state.sessions[payload.sessionId].messages;
                const idx = list.findIndex((m) => m.messageId === payload.messageId);
                if (idx !== -1) list[idx] = { ...list[idx], ...payload };
                else list.push(payload);
            }
            break;
        case Events.SESSION_TOOL_CALL:
            if (state.sessions[payload.sessionId]) {
                state.sessions[payload.sessionId].messages.push({
                    role: 'assistant',
                    messageId: payload.toolId,
                    content: [{ type: 'tool_call', ...payload }],
                });
            }
            break;
        case Events.SESSION_TOOL_RESULT:
            if (state.sessions[payload.sessionId]) {
                const msg = state.sessions[payload.sessionId].messages.find((m) => m.messageId === payload.toolId);
                if (msg) {
                    const block = msg.content.find((b) => b.type === 'tool_call');
                    if (block) {
                        block.result = payload.result;
                        block.isError = payload.isError;
                    }
                }
            }
            break;

        case Events.MODEL_POOL_SNAPSHOT:
            state.modelPool.slots = payload.slots;
            break;
        case Events.MODEL_POOL_ACQUIRE:
            state.modelPool.usage[payload.slotId] = {
                inUse: true,
                holder: payload.sessionId,
                nodeId: payload.nodeId,
                role: payload.role,
            };
            break;
        case Events.MODEL_POOL_RELEASE:
            delete state.modelPool.usage[payload.slotId];
            break;
        case Events.MODEL_POOL_CONFIG_UPDATE:
            if (payload.action === 'add') {
                state.modelPool.slots.push({
                    ...payload.slot,
                    slotId: payload.slot.slotId || `slot-${payload.slot.role}-${Date.now()}`,
                });
            } else if (payload.action === 'remove') {
                state.modelPool.slots = state.modelPool.slots.filter((s) => s.slotId !== payload.slotId);
            } else if (payload.action === 'edit') {
                const slot = state.modelPool.slots.find((s) => s.slotId === payload.slotId);
                if (slot) slot.thinkingLevel = payload.thinkingLevel;
            }
            break;
    }
    return state;
}

/**
 * Pure fold: (prevState, event) -> nextState (no mutation).
 * For the reactor and pure-function contexts.
 */
export function fold(state, entry) {
    const s = structuredClone(state);
    applyEvent(s, entry.event || entry.type, entry.payload);
    return s;
}

/**
 * Full scan projection of an EventLog array.
 * For cold-start and test contexts.
 */
export function project(log) {
    const state = getInitialState();
    for (const entry of log) {
        applyEvent(state, entry.event || entry.type, entry.payload);
    }
    return state;
}
