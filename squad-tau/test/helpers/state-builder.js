import { applyEvent, getInitialState } from '../../shared/projections.js';
import { sessionIdFor } from '../../shared/events.js';

export function buildState(overrides = {}) {
    const state = getInitialState();

    // Apply squad init via event
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

    // Apply outer review
    if (overrides.outerReview) {
        applyEvent(state, 'squad:outer_review_start', overrides.outerReview);
    }

    // Override squad-level fields
    if (overrides.squad) {
        Object.assign(state.squad, overrides.squad);
    }

    // Apply pre-existing sessions via events
    if (overrides.sessions) {
        for (const [sid, s] of Object.entries(overrides.sessions)) {
            const retryCount = s.retryCount != null ? s.retryCount : 0;
            const phase = s.phase || 'authoring';
            applyEvent(state, 'session:creating', {
                sessionId: sid,
                nodeId: s.nodeId,
                phase,
                retryCount,
            });
            applyEvent(state, 'session:start', {
                sessionId: sid,
                nodeId: s.nodeId,
                phase,
                retryCount,
                model: s.model,
            });
            if (s.status && s.status !== 'active') {
                applyEvent(state, 'session:state', { sessionId: sid, phase: s.status });
            }
            if (s.messages) {
                for (const msg of s.messages) {
                    applyEvent(state, 'session:message', { sessionId: sid, ...msg });
                }
            }
            if (s.latestReturn) {
                applyEvent(state, 'session:tool_call', {
                    sessionId: sid,
                    toolName: 'return',
                    toolId: `call-${sid}`,
                    params: s.latestReturn,
                });
            }
        }
    }

    // Apply model pool config
    if (overrides.modelPool || overrides.maxWorkers) {
        const mpOverrides = overrides.modelPool || {};
        applyEvent(state, 'model_pool:snapshot', {
            maxWorkers: overrides.maxWorkers || mpOverrides.maxWorkers || 3,
        });
    }

    return state;
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
    let sessionId;
    let retryCount = 0;
    if (nodeId) {
        const node = state.squad.nodes[nodeId];
        retryCount = node ? node.retryCount : 0;
        sessionId = sessionIdFor(nodeId, phase, retryCount);
    } else {
        sessionId = sessionIdFor('or', 'outer_review', state.squad.outerReview?.round || 1);
    }
    applyEvent(state, 'session:creating', { sessionId, nodeId, phase, retryCount });
    applyEvent(state, 'session:start', { sessionId, nodeId, phase, retryCount });
    return sessionId;
}

export function giveReturn(state, sessionId, status, reason) {
    const sess = state.sessions[sessionId];
    if (!sess) return;
    const params = { status, reason, affected_files: [] };
    applyEvent(state, 'session:tool_call', {
        sessionId,
        toolName: 'return',
        toolId: `call-${Date.now()}`,
        params,
    });
}
