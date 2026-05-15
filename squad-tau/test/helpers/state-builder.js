import { applyEvent, getInitialState } from '../../shared/projections.js';
import { sessionIdFor } from '../../shared/events.js';

export function buildState(overrides = {}) {
    let state = getInitialState();

    const nodeDefs = overrides.nodes || [];
    state = applyEvent(state, 'squad:init', {
        mode: overrides.mode || 'M',
        nodes: nodeDefs.map((n) => ({
            id: n.id,
            task: n.task || '',
            review_criteria: n.review_criteria || [],
            depends_on: n.depends_on || [],
        })),
        originalTask: overrides.originalTask || 'test task',
    });

    if (overrides.outerReview) {
        const or = overrides.outerReview;
        const ns =
            or.status === 'approved'
                ? 'approved'
                : or.status === 'rejected'
                  ? 'rejected'
                  : or.status === 'pending' || or.status === 'active'
                    ? 'reviewing'
                    : undefined;
        if (ns && state.squad.nodes.__or__) {
            state = applyEvent(state, 'squad:node_state', {
                nodeId: '__or__',
                status: ns,
                round: or.round,
                feedback: or.feedback,
            });
        }
    }

    if (overrides.squad) {
        state = { ...state, squad: { ...state.squad, ...overrides.squad } };
    }

    if (overrides.sessions) {
        for (const [sid, s] of Object.entries(overrides.sessions)) {
            const epoch = s.epoch ?? s.retryCount ?? 0;
            const phase = s.phase || 'authoring';
            const nodeId = s.nodeId || '__or__';

            state = applyEvent(state, 'session:creating', { sessionId: sid, nodeId, phase, epoch });
            state = applyEvent(state, 'session:start', { sessionId: sid, nodeId, phase, epoch, model: s.model });

            if (s.status && s.status !== 'active') {
                state = applyEvent(state, 'session:state', { sessionId: sid, phase: s.status });
            }

            if (s.messages) {
                for (const msg of s.messages) {
                    state = applyEvent(state, 'message:created', {
                        messageId: msg.messageId,
                        sessionId: sid,
                        role: msg.role,
                        parentId: msg.parentId,
                        staticContent: extractText(msg.content),
                    });
                    state = applyEvent(state, 'message:finalized', {
                        messageId: msg.messageId,
                        staticContent: extractText(msg.content),
                    });
                }
            }

            // latestReturn no longer stored — use domain facts instead
            if (s.reviewDecided) {
                state = applyEvent(state, 'node:review_decided', {
                    nodeId,
                    sessionId: sid,
                    approved: s.reviewDecided.approved,
                    summary: s.reviewDecided.summary || '',
                    epoch,
                });
            }
            if (s.workSubmitted) {
                state = applyEvent(state, 'node:work_submitted', {
                    nodeId,
                    sessionId: sid,
                    summary: s.workSubmitted.summary || '',
                    affected_files: s.workSubmitted.affected_files || [],
                    epoch,
                });
            }
        }
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
    const newState = applyEvent(state, 'squad:node_state', { nodeId, status, ...extra });
    Object.assign(state, newState);
}

export function createSession(state, nodeId, phase) {
    const resolvedId = nodeId || '__or__';
    const node = state.squad.nodes[resolvedId];
    const epoch = node?.epoch ?? node?.retryCount ?? 0;
    const sessionId = sessionIdFor(resolvedId, phase, epoch);
    let s = applyEvent(state, 'session:creating', { sessionId, nodeId: resolvedId, phase, epoch });
    s = applyEvent(s, 'session:start', { sessionId, nodeId: resolvedId, phase, epoch });
    Object.assign(state, s);
    return sessionId;
}

export function giveReturn(state, sessionId, status, reason) {
    const toolId = `call-${Date.now()}`;
    let s = applyEvent(state, 'tool_call:started', {
        sessionId,
        toolName: 'return',
        toolId,
        params: { status, reason, affected_files: [] },
    });

    // Extract phase from sessionId (format: nodeId::phase::v{epoch})
    const parts = sessionId.split('::');
    const phase = parts[1] || '';
    const nodeId = parts[0] || '';

    if (phase === 'reviewing') {
        s = applyEvent(s, 'node:review_decided', {
            nodeId,
            sessionId,
            approved: status === 'ok',
            summary: reason || '',
            affected_files: [],
            epoch: state.squad.nodes[nodeId]?.epoch ?? 0,
        });
    } else if (phase === 'authoring' || phase === 'confirming') {
        s = applyEvent(s, 'node:work_submitted', {
            nodeId,
            sessionId,
            summary: reason || '',
            affected_files: [],
            epoch: state.squad.nodes[nodeId]?.epoch ?? 0,
        });
    }

    Object.assign(state, s);
}
