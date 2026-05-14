import { STATUS } from '../../server/constants.js';
import { sessionIdFor } from '../../shared/events.js';

export function buildState(overrides = {}) {
    const nodeList = overrides.nodes || [];
    const nodes = {};
    for (const n of nodeList) nodes[n.id] = normalizeNode(n);
    return {
        squad: {
            status: 'active',
            nodes,
            results: [],
            originalTask: 'test task',
            outerReview: overrides.outerReview || undefined,
            ...overrides.squad,
        },
        sessions: { ...(overrides.sessions || {}) },
        modelPool: {
            slots: overrides.slots || [],
            maxWorkers: (overrides.slots || []).length || 3,
            ...overrides.modelPool,
        },
    };
}

function normalizeNode(n) {
    return {
        id: n.id,
        task: n.task || '',
        review_criteria: n.review_criteria || [],
        depends_on: n.depends_on || [],
        status: n.status || undefined,
        retryCount: n.retryCount || 0,
        summary: n.summary || undefined,
        feedback: n.feedback || undefined,
        affectedFiles: n.affectedFiles || undefined,
    };
}

export function createBaseState(...nodeDefs) {
    const list =
        nodeDefs.length > 0
            ? nodeDefs.map((d) => (typeof d === 'string' ? { id: d, task: 'task', review_criteria: [] } : d))
            : [{ id: 'n1', task: 'task', review_criteria: [] }];
    return buildState({ nodes: list });
}

export function setStatus(state, nodeId, status, extra = {}) {
    const node = state.squad.nodes[nodeId];
    if (node) Object.assign(node, { status, ...extra });
}

export function createSession(state, nodeId, phase) {
    let sessionId;
    if (nodeId) {
        const node = state.squad.nodes[nodeId];
        sessionId = sessionIdFor(nodeId, phase, node ? node.retryCount : 0);
    } else {
        sessionId = sessionIdFor('or', 'outer_review', state.squad.outerReview?.round || 1);
    }
    state.sessions[sessionId] = { sessionId, nodeId, phase, role: phase, status: 'active', messages: [] };
    return sessionId;
}

export function addSlot(state, slotDef = {}) {
    const slotId = slotDef.slotId || `slot-${state.modelPool.slots.length}-${slotDef.role || 'worker'}`;
    state.modelPool.slots.push({ slotId, role: 'worker', provider: 'test', modelId: 'default', ...slotDef, slotId });
    state.modelPool.maxWorkers = state.modelPool.slots.length;
    return slotId;
}

export function setSlots(state, slots) {
    state.modelPool.slots = slots;
    state.modelPool.maxWorkers = slots.length || 3;
}

export function giveReturn(state, sessionId, status, reason) {
    const sess = state.sessions[sessionId];
    if (!sess) return;
    const params = { status, reason, affected_files: [] };
    sess.messages.push({
        role: 'assistant',
        messageId: `call-${Date.now()}`,
        content: [{ type: 'tool_call', toolName: 'return', toolId: `call-${Date.now()}`, params }],
    });
    sess.latestReturn = params;
}
