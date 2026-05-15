/**
 * Homomorphic event projections — shared between client and server.
 * v5: Zero-content, flat normalized state, entity-level tracking.
 *
 * Messages have NO text/content — only topology metadata.
 * User messages carry staticContent (immutable once written).
 * Agent messages stream via CustomElements; state tree never holds their text.
 *
 * No .find() / .findIndex() — O(1) hash lookups only.
 * No != null fallbacks — fail fast on contract violation.
 */

const Reducers = {};

function register(event) {
    return (fn) => {
        Reducers[event] = fn;
    };
}

export function getInitialState() {
    return {
        squad: { status: 'idle', nodes: {}, results: [], originalTask: '' },
        sessions: {},
        messages: {},
        toolCalls: {},
        modelPool: { maxWorkers: 3 },
    };
}

// ── Entity Lifecycle (unified message lifecycle) ──

register('entity:created')((state, payload) => {
    if (payload.entityType === 'message') {
        state.messages[payload.entityId] = {
            messageId: payload.entityId,
            sessionId: payload.sessionId,
            role: payload.role,
            status: 'created',
            parentId: payload.parentId,
            staticContent: payload.staticContent,
            toolIds: [],
        };
        const sess = state.sessions[payload.sessionId];
        if (sess) sess.messageIds = [...sess.messageIds, payload.entityId];
    }
});

register('entity:finalized')((state, payload) => {
    if (payload.entityType === 'message') {
        const msg = state.messages[payload.entityId];
        if (!msg) return;
        msg.status = 'finalized';
        if (payload.staticContent) msg.staticContent = payload.staticContent;
    }
});

// ── Squad Lifecycle ──

register('squad:init')((state, payload) => {
    const nodes = {};
    if (payload.nodes) {
        for (const n of payload.nodes) {
            nodes[n.id] = {
                id: n.id,
                task: n.task || '',
                review_criteria: n.review_criteria || [],
                depends_on: n.depends_on || [],
                status: undefined,
                retryCount: 0,
                summary: undefined,
                feedback: undefined,
                affectedFiles: undefined,
                lastPromptedPhase: null,
            };
        }
    }
    state.squad = { ...state.squad, ...payload, nodes, status: 'active' };
});

register('squad:node_state')((state, payload) => {
    const node = state.squad.nodes[payload.nodeId];
    if (!node) return;
    Object.assign(node, payload);
});

register('squad:complete')((state, payload) => {
    state.squad.status = 'complete';
    state.squad.results = payload.results;
});

register('squad:abort')((state) => {
    state.squad.status = 'aborted';
});

register('squad:outer_review_start')((state, payload) => {
    state.squad.outerReview = { status: 'pending', round: payload.round || 1 };
});

register('squad:outer_review_done')((state) => {
    if (state.squad.outerReview) state.squad.outerReview.status = 'approved';
});

register('squad:outer_review_failed')((state, payload) => {
    state.squad.outerReview = {
        status: 'rejected',
        round: state.squad.outerReview?.round || 1,
        feedback: payload.reason,
    };
});

// ── Session Lifecycle ──

register('session:creating')((state, payload) => {
    state.sessions[payload.sessionId] = state.sessions[payload.sessionId] || {
        sessionId: payload.sessionId,
        nodeId: payload.nodeId,
        phase: payload.phase,
        role: payload.phase,
        status: 'creating',
        messageIds: [],
        retryCount: payload.retryCount,
    };
});

register('session:start')((state, payload) => {
    const sid = payload.sessionId;
    if (state.sessions[sid]) {
        state.sessions[sid].status = 'active';
        state.sessions[sid].model = payload.model;
        state.sessions[sid].retryCount = payload.retryCount;
    } else {
        state.sessions[sid] = {
            sessionId: sid,
            nodeId: payload.nodeId,
            phase: payload.phase,
            role: payload.phase,
            status: 'active',
            messageIds: [],
            model: payload.model,
            retryCount: payload.retryCount,
        };
    }
});

register('session:prompting')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    sess.lastPromptedPhase = payload.phase;
    if (sess.role === 'outer_review' && state.squad.outerReview) {
        state.squad.outerReview.lastPrompted = true;
    }
});

register('session:state')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    sess.phase = payload.phase;
    sess.status = ['completed', 'aborted', 'error'].includes(payload.phase) ? payload.phase : 'active';
});

register('session:end')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    sess.status = payload.reason || 'completed';
    if (payload.errorMessage) sess.errorMessage = payload.errorMessage;
});

// ── Legacy message events (server emits these; WS hook maps to entity:*) ──
// These are kept for server-side projection where WS hook isn't involved.
// Client-side only processes via EventStore which receives mapped events.
// But for engine simulation (timeTravel), the server-side projections
// must handle these directly.

register('session:message_start')((state, payload) => {
    state.messages[payload.messageId] = {
        messageId: payload.messageId,
        sessionId: payload.sessionId,
        role: payload.role || 'assistant',
        status: 'created',
        parentId: payload.parentId,
        staticContent: undefined,
        toolIds: [],
    };
    const sess = state.sessions[payload.sessionId];
    if (sess) sess.messageIds = [...sess.messageIds, payload.messageId];
});

register('session:message')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    if (state.messages[payload.messageId]) {
        state.messages[payload.messageId].status = 'finalized';
        if (payload.role === 'user') {
            const text = extractText(payload.content);
            if (text) state.messages[payload.messageId].staticContent = text;
        }
    } else {
        const text = payload.role === 'user' ? extractText(payload.content) : undefined;
        state.messages[payload.messageId] = {
            messageId: payload.messageId,
            sessionId: payload.sessionId,
            role: payload.role,
            status: 'finalized',
            parentId: payload.parentId,
            staticContent: text,
            toolIds: [],
        };
        sess.messageIds = [...sess.messageIds, payload.messageId];
    }
});

function extractText(content) {
    if (!content) return '';
    const blocks = Array.isArray(content) ? content : [content];
    const tb = blocks.find((b) => b.type === 'text');
    return tb ? tb.text : '';
}

// ── Tool Calls ──

register('session:tool_call')((state, payload) => {
    const { sessionId, toolId, toolName, params, messageId } = payload;
    state.toolCalls[toolId] = {
        toolId,
        sessionId,
        messageId: messageId || '',
        toolName,
        params,
        result: undefined,
        isError: undefined,
    };
    // Link to message if messageId provided
    if (messageId && state.messages[messageId]) {
        const msg = state.messages[messageId];
        if (!msg.toolIds.includes(toolId)) msg.toolIds = [...msg.toolIds, toolId];
    }
    // Track latestReturn for reactor
    if (toolName === 'return') {
        const sess = state.sessions[sessionId];
        if (sess) sess.latestReturn = params;
    }
});

register('session:tool_result')((state, payload) => {
    const tc = state.toolCalls[payload.toolId];
    if (!tc) return;
    tc.result = payload.result;
    tc.isError = payload.isError === true;
});

// ── Model Pool ──

register('model_pool:snapshot')((state, payload) => {
    if (payload.maxWorkers) state.modelPool.maxWorkers = payload.maxWorkers;
});

// ── UI State (client-side only) ──

register('ui:select_session')((state, payload) => {
    state.ui = state.ui || { viewMode: 'dag', activeSessionId: null, drawerOpen: false, bannerDismissed: false };
    state.ui.activeSessionId = payload.sessionId;
    state.ui.viewMode = 'session';
});

register('ui:set_view_mode')((state, payload) => {
    state.ui = state.ui || { viewMode: 'dag', activeSessionId: null, drawerOpen: false, bannerDismissed: false };
    state.ui.viewMode = payload.viewMode;
});

register('ui:toggle_drawer')((state, payload) => {
    state.ui = state.ui || { viewMode: 'dag', activeSessionId: null, drawerOpen: false, bannerDismissed: false };
    state.ui.drawerOpen = payload.open;
});

register('ui:dismiss_banner')((state) => {
    state.ui = state.ui || { viewMode: 'dag', activeSessionId: null, drawerOpen: false, bannerDismissed: false };
    state.ui.bannerDismissed = true;
});

// ── Dispatch ──

export function applyEvent(state, type, payload) {
    Reducers[type]?.(state, payload);
    return state;
}

export function fold(state, entry) {
    const s = structuredClone(state);
    Reducers[entry.event || entry.type]?.(s, entry.payload);
    return s;
}

export function project(log) {
    const state = getInitialState();
    for (const entry of log) {
        Reducers[entry.event || entry.type]?.(state, entry.payload);
    }
    return state;
}
