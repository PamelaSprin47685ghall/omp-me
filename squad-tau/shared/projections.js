/**
 * Homomorphic event projections — shared between client and server.
 * v4: Flat state (nodes as map), deterministic URN sessions, no model pool.
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
        modelPool: { maxWorkers: 3 },
    };
}

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

// ── Outer Review ──

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
        messages: [],
        retryCount: payload.retryCount != null ? payload.retryCount : 0,
    };
});

register('session:start')((state, payload) => {
    const sid = payload.sessionId;
    if (state.sessions[sid]) {
        state.sessions[sid].status = 'active';
        state.sessions[sid].model = payload.model;
        state.sessions[sid].retryCount =
            payload.retryCount != null ? payload.retryCount : state.sessions[sid].retryCount || 0;
    } else {
        state.sessions[sid] = {
            sessionId: sid,
            nodeId: payload.nodeId,
            phase: payload.phase,
            role: payload.phase,
            status: 'active',
            messages: [],
            model: payload.model,
            retryCount: payload.retryCount != null ? payload.retryCount : 0,
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

register('session:message')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    const list = sess.messages;
    const idx = list.findIndex((m) => m.messageId === payload.messageId);
    if (idx !== -1) list[idx] = { ...list[idx], ...payload };
    else list.push(payload);
    // Initialize flat string caches from complete content
    const msg = idx !== -1 ? list[idx] : list[list.length - 1];
    if (Array.isArray(msg.content)) {
        msg.joinedText = msg.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
        msg.joinedThinking = msg.content
            .filter((b) => b.type === 'thinking')
            .map((b) => b.text)
            .join('');
    }
});

// ── Streaming Delta (transient, never stored in EventLog) ──

register('session:message_delta')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    const list = sess.messages;
    const msgIdx = list.findIndex((m) => m.messageId === payload.messageId);

    if (msgIdx === -1) {
        const blockType = payload.delta.type === 'thinking_delta' ? 'thinking' : 'text';
        const text = payload.delta.text || '';
        list.push({
            role: 'assistant',
            messageId: payload.messageId,
            content: [{ type: blockType, text }],
            streaming: true,
            joinedText: payload.delta.type !== 'thinking_delta' ? text : '',
            joinedThinking: payload.delta.type === 'thinking_delta' ? text : '',
        });
    } else {
        const msg = list[msgIdx];
        if (!msg.streaming) msg.streaming = true;
        if (payload.delta.type === 'thinking_delta') {
            const t = payload.delta.text || '';
            msg.joinedThinking = (msg.joinedThinking || '') + t;
            const hasThinking = msg.content.some((c) => c.type === 'thinking');
            if (!hasThinking) msg.content.push({ type: 'thinking', text: '' });
        } else {
            const t = payload.delta.text || '';
            msg.joinedText = (msg.joinedText || '') + t;
        }
    }
});

register('session:thinking_delta')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    const list = sess.messages;
    const msgIdx = list.findIndex((m) => m.messageId === payload.messageId);

    if (msgIdx === -1) {
        const text = payload.delta.text || '';
        list.push({
            role: 'assistant',
            messageId: payload.messageId,
            content: [{ type: 'thinking', text }],
            streaming: true,
            joinedText: '',
            joinedThinking: text,
        });
    } else {
        const msg = list[msgIdx];
        if (!msg.streaming) msg.streaming = true;
        const t = payload.delta.text || '';
        msg.joinedThinking = (msg.joinedThinking || '') + t;
        const hasThinking = msg.content.some((c) => c.type === 'thinking');
        if (!hasThinking) msg.content.push({ type: 'thinking', text: '' });
    }
});

register('session:tool_call')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    const { sessionId, ...toolFields } = payload;
    sess.messages.push({
        role: 'assistant',
        messageId: payload.toolId,
        content: [{ type: 'tool_call', ...toolFields }],
    });
    if (payload.toolName === 'return') {
        sess.latestReturn = payload.params;
    }
});

register('session:tool_result')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    if (!sess) return;
    const msg = sess.messages.find((m) => m.messageId === payload.toolId);
    if (!msg) return;
    const block = msg.content.find((b) => b.type === 'tool_call');
    if (!block) return;
    block.result = payload.result;
    block.isError = payload.isError;
});

// ── Model Pool Config (static, no runtime usage tracking) ──

register('model_pool:snapshot')((state, payload) => {
    if (payload.maxWorkers) state.modelPool.maxWorkers = payload.maxWorkers;
});

// ── UI State (client-side only) — each event has its own reducer, no switch

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
