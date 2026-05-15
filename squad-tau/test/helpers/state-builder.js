import { applyEvent, getInitialState } from '../../shared/projections.js';
import { sessionIdFor } from '../../shared/events.js';

export function buildState(overrides = {}) {
    const state = getInitialState();

    const nodeDefs = overrides.nodes || [];
    applyEvent(state, 'squad:init', {
        mode: overrides.mode || 'M',
        nodes: nodeDefs.map((n) => ({
            id: n.id,
            task: n.task || '',
            review_criteria: n.review_criteria || [],
            depends_on: n.depends_on || [],
        })),
        originalTask: overrides.originalTask || 'test task',
    });

    // Legacy outerReview compatibility: translate to __or__ node status
    if (overrides.outerReview) {
        const or = overrides.outerReview;
        const nodeStatus =
            or.status === 'approved'
                ? 'approved'
                : or.status === 'rejected'
                  ? 'rejected'
                  : or.status === 'pending' || or.status === 'active'
                    ? 'reviewing'
                    : undefined;
        if (nodeStatus && state.squad.nodes.__or__) {
            applyEvent(state, 'squad:node_state', {
                nodeId: '__or__',
                status: nodeStatus,
                round: or.round,
                feedback: or.feedback,
            });
        }
    }

    if (overrides.squad) {
        Object.assign(state.squad, overrides.squad);
    }

    if (overrides.sessions) {
        for (const [sid, s] of Object.entries(overrides.sessions)) {
            const retryCount = s.retryCount || 0;
            const phase = s.phase || 'authoring';
            const nodeId = s.nodeId || '__or__';

            applyEvent(state, 'session:creating', { sessionId: sid, nodeId, phase, retryCount });
            applyEvent(state, 'session:start', { sessionId: sid, nodeId, phase, retryCount, model: s.model });

            if (s.status && s.status !== 'active') {
                applyEvent(state, 'session:state', { sessionId: sid, phase: s.status });
            }

            if (s.messages) {
                for (const msg of s.messages) {
                    applyEvent(state, 'message:created', {
                        messageId: msg.messageId,
                        sessionId: sid,
                        role: msg.role,
                        parentId: msg.parentId,
                        staticContent: extractText(msg.content),
                    });
                    applyEvent(state, 'message:finalized', {
                        messageId: msg.messageId,
                        staticContent: extractText(msg.content),
                    });
                }
            }

            if (s.latestReturn) {
                applyEvent(state, 'tool_call:started', {
                    sessionId: sid,
                    toolName: 'return',
                    toolId: `call-${sid}`,
                    params: s.latestReturn,
                });
            }
        }
    }

    if (overrides.modelPool || overrides.maxWorkers) {
        const mp = overrides.modelPool || {};
        applyEvent(state, 'model_pool:snapshot', {
            maxWorkers: overrides.maxWorkers || mp.maxWorkers || 3,
        });
    }

    return state;
}

function extractText(content) {
    if (!content) return '';
    const blocks = Array.isArray(content) ? content : [content];
    const tb = blocks.find((b) => b.type === 'text');
    return tb ? tb.text : '';
}

export function createBaseState(...nodeDefs) {
    const list =
        nodeDefs.length > 0
            ? nodeDefs.map((d) => (typeof d === 'string' ? { id: d, task: 'task', review_criteria: [] } : d))
            : [{ id: 'n1', task: 'task', review_criteria: [] }];
    return buildState({ nodes: list });
}

export function setStatus(state, nodeId, status, extra = {}) {
    applyEvent(state, 'squad:node_state', { nodeId, status, ...extra });
}

export function createSession(state, nodeId, phase) {
    const resolvedId = nodeId || '__or__';
    const node = state.squad.nodes[resolvedId];
    const retryCount = node?.retryCount || 0;
    const sessionId = sessionIdFor(resolvedId, phase, retryCount);
    applyEvent(state, 'session:creating', { sessionId, nodeId: resolvedId, phase, retryCount });
    applyEvent(state, 'session:start', { sessionId, nodeId: resolvedId, phase, retryCount });
    return sessionId;
}

export function giveReturn(state, sessionId, status, reason) {
    applyEvent(state, 'tool_call:started', {
        sessionId,
        toolName: 'return',
        toolId: `call-${Date.now()}`,
        params: { status, reason, affected_files: [] },
    });
}
