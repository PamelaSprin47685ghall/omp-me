/**
 * Homomorphic event projections — shared between client and server.
 * v6: Domain events only, invariant-driven, no defensive code.
 *
 * Messages have NO text/content — only topology metadata.
 * Agent messages stream via CustomElements; state tree never holds their text.
 *
 * No .find() / .findIndex() — O(1) hash lookups only.
 * No fallbacks — fail fast on contract violation.
 */

function invariant(cond, msg) {
    if (!cond) throw new Error(`[Projection] ${msg}`);
}

// ── Touch declarations: each reducer declares what keys it mutates.
// EventStore consumes these for granular subscriptions without hardcoding.

const TOUCHES = {};

function touches(type, fn) {
    TOUCHES[type] = fn;
}

function register(type) {
    return (fn) => {
        Reducers[type] = fn;
    };
}

const Reducers = {};

export function getInitialState() {
    return {
        squad: { status: 'idle', nodes: {}, results: [], originalTask: '', mode: 'M' },
        sessions: {},
        messages: {},
        toolCalls: {},
        modelPool: { maxWorkers: 3 },
        ui: { viewMode: 'dag', activeSessionId: null, drawerOpen: false, bannerDismissed: false },
    };
}

// ── Message Lifecycle ──

touches('message:created', (p) => ['messages', `messages:${p.messageId}`, `sessions:${p.sessionId}`]);

register('message:created')((state, payload) => {
    const { messageId, sessionId, role, parentId, staticContent } = payload;
    invariant(sessionId, 'message:created requires sessionId');
    invariant(messageId, 'message:created requires messageId');

    state.messages[messageId] = { messageId, sessionId, role, status: 'created', parentId, staticContent, toolIds: [] };
    invariant(state.sessions[sessionId], `message:created references nonexistent session ${sessionId}`);
    state.sessions[sessionId].messageIds.push(messageId);
});

touches('message:finalized', (p) => ['messages', `messages:${p.messageId}`]);

register('message:finalized')((state, payload) => {
    const msg = state.messages[payload.messageId];
    invariant(msg, `message:finalized references nonexistent message ${payload.messageId}`);
    msg.status = 'finalized';
    if (payload.staticContent !== undefined) msg.staticContent = payload.staticContent;
});

// ── Tool Call Lifecycle ──

touches('tool_call:started', (p) => [
    'toolCalls',
    `toolCalls:${p.toolId}`,
    ...(p.messageId ? [`messages:${p.messageId}`] : []),
    `sessions:${p.sessionId}`,
]);

register('tool_call:started')((state, payload) => {
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
    if (messageId && state.messages[messageId]) {
        const msg = state.messages[messageId];
        msg.toolIds.push(toolId);
    }
    if (toolName === 'return') {
        state.sessions[sessionId].latestReturn = params;
    }
});

touches('tool_call:finished', (p) => ['toolCalls', `toolCalls:${p.toolId}`]);

register('tool_call:finished')((state, payload) => {
    const tc = state.toolCalls[payload.toolId];
    invariant(tc, `tool_call:finished references nonexistent tool call ${payload.toolId}`);
    tc.result = payload.result;
    tc.isError = payload.isError === true;
});

// ── Squad Lifecycle ──

touches('squad:init', () => ['squad']); // node-level keys tracked individually

register('squad:init')((state, payload) => {
    const nodes = {};
    const workerIds = [];
    for (const n of payload.nodes || []) {
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
            phases: ['authoring', 'confirming', 'reviewing'],
            maxRetries: 5,
            resetDependentsOnRejection: false,
        };
        workerIds.push(n.id);
    }
    // L mode: inject __or__ outer review node as a regular task node
    if (payload.mode === 'L') {
        nodes.__or__ = {
            id: '__or__',
            task: payload.originalTask || '',
            review_criteria: [],
            depends_on: [...workerIds],
            status: undefined,
            retryCount: 0,
            summary: undefined,
            feedback: undefined,
            affectedFiles: undefined,
            lastPromptedPhase: null,
            phases: ['reviewing'],
            maxRetries: Infinity,
            resetDependentsOnRejection: true,
        };
    }
    state.squad.status = 'active';
    state.squad.mode = payload.mode;
    state.squad.nodes = nodes;
    state.squad.originalTask = payload.originalTask || '';
    state.squad.results = [];
});

touches('squad:node_state', (p) => ['squad', `squad:nodes:${p.nodeId}`]);

register('squad:node_state')((state, payload) => {
    const node = state.squad.nodes[payload.nodeId];
    invariant(node, `squad:node_state references nonexistent node ${payload.nodeId}`);
    Object.assign(node, payload);
});

touches('squad:complete', () => ['squad']);

register('squad:complete')((state, payload) => {
    state.squad.status = 'complete';
    state.squad.results = payload.results;
});

touches('squad:abort', () => ['squad']);

register('squad:abort')((state) => {
    state.squad.status = 'aborted';
});

// ── Session Lifecycle ──

touches('session:creating', (p) => ['sessions', `sessions:${p.sessionId}`]);

register('session:creating')((state, payload) => {
    state.sessions[payload.sessionId] = {
        sessionId: payload.sessionId,
        nodeId: payload.nodeId,
        phase: payload.phase,
        role: payload.phase,
        status: 'creating',
        messageIds: [],
        retryCount: payload.retryCount,
    };
});

touches('session:start', (p) => ['sessions', `sessions:${p.sessionId}`]);

register('session:start')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:start references nonexistent session ${payload.sessionId}`);
    sess.status = 'active';
    sess.model = payload.model;
    sess.retryCount = payload.retryCount;
});

touches('session:prompting', (p) => ['sessions', `sessions:${p.sessionId}`]);

register('session:prompting')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:prompting references nonexistent session ${payload.sessionId}`);
    sess.lastPromptedPhase = payload.phase;
});

touches('session:state', (p) => ['sessions', `sessions:${p.sessionId}`]);

register('session:state')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:state references nonexistent session ${payload.sessionId}`);
    sess.phase = payload.phase;
    sess.status = ['completed', 'aborted', 'error'].includes(payload.phase) ? payload.phase : 'active';
});

touches('session:end', (p) => ['sessions', `sessions:${p.sessionId}`]);

register('session:end')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:end references nonexistent session ${payload.sessionId}`);
    sess.status = payload.reason || 'completed';
    if (payload.errorMessage) sess.errorMessage = payload.errorMessage;
});

// ── Model Pool ──

touches('model_pool:snapshot', () => ['modelPool']);

register('model_pool:snapshot')((state, payload) => {
    if (payload.maxWorkers) state.modelPool.maxWorkers = payload.maxWorkers;
});

// ── UI State ──

touches('ui:select_session', () => ['ui']);

register('ui:select_session')((state, payload) => {
    state.ui.activeSessionId = payload.sessionId;
    state.ui.viewMode = 'session';
});

touches('ui:set_view_mode', () => ['ui']);

register('ui:set_view_mode')((state, payload) => {
    state.ui.viewMode = payload.viewMode;
});

touches('ui:toggle_drawer', () => ['ui']);

register('ui:toggle_drawer')((state, payload) => {
    state.ui.drawerOpen = payload.open;
});

touches('ui:dismiss_banner', () => ['ui']);

register('ui:dismiss_banner')((state) => {
    state.ui.bannerDismissed = true;
});

// ── Dispatch ──

export function applyEvent(state, type, payload) {
    Reducers[type]?.(state, payload);
    return state;
}

export function getTouchedKeys(type, payload) {
    return TOUCHES[type]?.(payload) || [];
}

export function fold(state, entry) {
    const s = structuredClone(state);
    applyEvent(s, entry.event || entry.type, entry.payload);
    return s;
}

export function project(log) {
    const state = getInitialState();
    for (const entry of log) {
        applyEvent(state, entry.event || entry.type, entry.payload);
    }
    return state;
}
