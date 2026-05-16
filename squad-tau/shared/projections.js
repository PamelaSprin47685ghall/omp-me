/* O(1) fold — no .find/.filter/scan; structural sharing; no fallbacks. */
function $err(cond, msg) {
    if (!cond) throw Error('[Projection] ' + msg);
}

const R = {};
function reg(t, fn) {
    R[t] = fn;
}

export function getInitialState() {
    return {
        nodes: Object.create(null),
        runtime: { sessions: Object.create(null) },
        stats: { activeCount: 0 },
        config: { maxWorkers: 3 },
        // UI defaults (client-side only, harmless on server)
        squad: { status: null, nodes: Object.create(null), results: [], mode: 'M', originalTask: '' },
        ui: { sidebarOpen: false, viewMode: 'dag', activeSessionId: null, drawerOpen: false, bannerDismissed: false },
    };
}

// ── UI Fact reducers (frontend viewport state) ──

reg('ui:toggle_sidebar', (state) => {
    return { ...state, ui: { ...state.ui, sidebarOpen: !state.ui.sidebarOpen } };
});

reg('ui:select_session', (state, p) => {
    return { ...state, ui: { ...state.ui, activeSessionId: p.sessionId || null, viewMode: 'session' } };
});

reg('ui:set_view_mode', (state, p) => {
    return { ...state, ui: { ...state.ui, viewMode: p.viewMode || 'dag' } };
});

reg('ui:toggle_drawer', (state, p) => {
    return { ...state, ui: { ...state.ui, drawerOpen: p.open !== undefined ? p.open : !state.ui.drawerOpen } };
});

reg('ui:dismiss_banner', (state) => {
    return { ...state, ui: { ...state.ui, bannerDismissed: true } };
});

reg('session:pending_creation', (state, p) => {
    $err(p.sessionId, 'pending_creation requires sessionId');
    $err(p.nodeId, 'pending_creation requires nodeId');
    return {
        ...state,
        runtime: {
            ...state.runtime,
            sessions: {
                ...state.runtime.sessions,
                [p.sessionId]: {
                    sessionId: p.sessionId,
                    nodeId: p.nodeId,
                    phase: p.phase,
                    epoch: p.epoch,
                    status: 'pending',
                },
            },
        },
    };
});

reg('session:pending_prompt', (state, p) => {
    const s = state.runtime.sessions[p.sessionId];
    $err(s, 'pending_prompt for unknown session ' + p.sessionId);
    return {
        ...state,
        runtime: {
            ...state.runtime,
            sessions: {
                ...state.runtime.sessions,
                [p.sessionId]: { ...s, status: 'prompting', pendingMessages: undefined },
            },
        },
    };
});

reg('session:start', (state, p) => {
    $err(p.sessionId, 'session:start requires sessionId');
    $err(p.nodeId, 'session:start requires nodeId');
    $err(p.epoch !== undefined, 'session:start requires epoch');
    return {
        ...state,
        runtime: {
            ...state.runtime,
            sessions: {
                ...state.runtime.sessions,
                [p.sessionId]: {
                    sessionId: p.sessionId,
                    nodeId: p.nodeId,
                    epoch: p.epoch,
                    model: p.model || null,
                    phase: p.phase || 'authoring',
                    status: 'active',
                },
            },
        },
        stats: { ...state.stats, activeCount: state.stats.activeCount + 1 },
    };
});

reg('session:end', (state, p) => {
    $err(p.sessionId, 'session:end requires sessionId');
    const s = state.runtime.sessions[p.sessionId];
    $err(s, 'session:end for unknown session ' + p.sessionId);
    return {
        ...state,
        runtime: {
            ...state.runtime,
            sessions: {
                ...state.runtime.sessions,
                [p.sessionId]: { ...s, status: 'ended', reason: p.reason || 'completed', errorMessage: p.errorMessage },
            },
        },
        stats: { ...state.stats, activeCount: state.stats.activeCount - 1 },
    };
});

reg('session:faulted', (state, p) => {
    const s = state.runtime.sessions[p.sessionId];
    $err(s, 'session:faulted for unknown session ' + p.sessionId);
    return {
        ...state,
        runtime: {
            ...state.runtime,
            sessions: {
                ...state.runtime.sessions,
                [p.sessionId]: { ...s, status: 'faulted', faultReason: p.reason || 'unknown' },
            },
        },
    };
});

// Phase order
const PHASES = ['authoring', 'confirming', 'reviewing'];
function _nextPhase(cur) {
    const i = PHASES.indexOf(cur);
    return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null;
}

reg('node:phase_advanced', (state, p) => {
    $err(p.nodeId, 'phase_advanced requires nodeId');
    const n = state.nodes[p.nodeId];
    $err(n, 'phase_advanced for unknown node ' + p.nodeId);
    const newStatus = p.status || _nextPhase(n.status) || 'approved';
    let sessions = state.runtime.sessions;
    if (p.sessionId && sessions[p.sessionId]) {
        sessions = { ...sessions, [p.sessionId]: { ...sessions[p.sessionId], _advanced: true } };
    }
    return {
        ...state,
        nodes: {
            ...state.nodes,
            [p.nodeId]: { ...n, status: newStatus, epoch: p.epoch ?? n.epoch, summary: p.summary ?? n.summary },
        },
        runtime: { ...state.runtime, sessions },
    };
});

reg('node:rejected', (state, p) => {
    $err(p.nodeId, 'node:rejected requires nodeId');
    const n = state.nodes[p.nodeId];
    $err(n, 'node:rejected for unknown node ' + p.nodeId);
    let sessions = state.runtime.sessions;
    if (p.sessionId && sessions[p.sessionId]) {
        sessions = { ...sessions, [p.sessionId]: { ...sessions[p.sessionId], _advanced: true } };
    }
    return {
        ...state,
        nodes: { ...state.nodes, [p.nodeId]: { ...n, status: 'rejected', feedback: p.feedback || '' } },
        runtime: { ...state.runtime, sessions },
    };
});

reg('node:failed', (state, p) => {
    $err(p.nodeId, 'node:failed requires nodeId');
    const n = state.nodes[p.nodeId];
    $err(n, 'node:failed for unknown node ' + p.nodeId);
    return { ...state, nodes: { ...state.nodes, [p.nodeId]: { ...n, status: 'failed' } } };
});

reg('squad:register_main_session', (state, p) => {
    $err(p.sessionId, 'register_main_session requires sessionId');
    return { ...state, squad: Object.assign({}, state.squad || {}, { mainSessionId: p.sessionId }) };
});

reg('squad:init', (state, p) => {
    $err(p.nodes, 'squad:init requires nodes array');
    const nodes = Object.create(null);
    for (const n of p.nodes) {
        const deps = n.depends_on || [];
        nodes[n.id] = {
            id: n.id,
            depends_on: deps,
            status: deps.length === 0 ? 'authoring' : undefined,
            epoch: 0,
            summary: undefined,
        };
    }
    return {
        ...state,
        nodes,
        squad: Object.assign({}, state.squad || {}, {
            status: 'active',
            mode: p.mode || 'M',
            originalTask: p.originalTask || '',
            mainSessionId: p.mainSessionId !== undefined ? p.mainSessionId : (state.squad || {}).mainSessionId,
        }),
    };
});

reg('squad:node_state', (state, p) => {
    $err(p.nodeId, 'squad:node_state requires nodeId');
    const n = state.nodes[p.nodeId];
    $err(n, 'squad:node_state for unknown node ' + p.nodeId);
    return { ...state, nodes: { ...state.nodes, [p.nodeId]: { ...n, ...p } } };
});

reg('squad:complete', (state, p) => {
    return { ...state, squad: Object.assign({}, state.squad || {}, { status: 'complete', results: p.results || [] }) };
});

reg('squad:abort', (state) => {
    return { ...state, squad: Object.assign({}, state.squad || {}, { status: 'aborted' }) };
});

// ── Message Skeleton (client-side) ──
// message:start creates a skeleton entry so React renders a placeholder.
// Actual text content flows through StreamRouter, never through projections.

reg('message:start', (state, p) => {
    $err(p.messageId, 'message:start requires messageId');
    $err(p.sessionId, 'message:start requires sessionId');
    const msgs = state.messages || Object.create(null);
    const base = {
        messageId: p.messageId,
        sessionId: p.sessionId,
        role: 'assistant',
        status: 'streaming',
        blocks: [{ type: 'text', id: p.messageId }],
    };
    if (p.parentId !== undefined) base.parentId = p.parentId;
    // Track messageId on session for UI listing (O(1) append)
    const sessions = state.runtime.sessions;
    const sess = sessions[p.sessionId];
    const msgIds = sess?.messageIds ? [...sess.messageIds, p.messageId] : [p.messageId];
    return {
        ...state,
        messages: { ...msgs, [p.messageId]: base },
        runtime: sess
            ? { ...state.runtime, sessions: { ...sessions, [p.sessionId]: { ...sess, messageIds: msgIds } } }
            : state.runtime,
    };
});

reg('message:finalized', (state, p) => {
    const msgs = state.messages || Object.create(null);
    const m = msgs[p.messageId];
    $err(m, 'message:finalized for unknown message ' + p.messageId);
    return {
        ...state,
        messages: {
            ...msgs,
            [p.messageId]: { ...m, status: 'finalized', staticContent: p.staticContent || m.staticContent },
        },
    };
});

reg('squad:replan', (state, p) => {
    $err(p.nodes, 'squad:replan requires nodes array');
    const nodes = Object.create(null);
    for (const n of p.nodes) {
        const deps = n.depends_on || [];
        nodes[n.id] = {
            id: n.id,
            depends_on: deps,
            status: deps.length === 0 ? 'authoring' : undefined,
            epoch: 0,
            summary: undefined,
        };
    }
    // Overwrite topology but preserve running sessions (old execution history stays in EventLog)
    return {
        ...state,
        nodes,
        squad: Object.assign({}, state.squad || {}, {
            status: 'active',
            mode: p.mode || 'M',
            originalTask: p.originalTask || '',
            mainSessionId: p.mainSessionId !== undefined ? p.mainSessionId : (state.squad || {}).mainSessionId,
        }),
    };
});

// ── Tool Calls (O(1) hash) ──

reg('tool_call:started', (state, p) => {
    $err(p.toolId, 'tool_call:started requires toolId');
    $err(p.toolName, 'tool_call:started requires toolName');
    const calls = state.toolCalls || Object.create(null);
    const entry = {
        toolId: p.toolId,
        toolName: p.toolName,
        params: p.params || {},
        status: 'running',
        sessionId: p.sessionId || null,
    };
    if (p.messageId) {
        const msgs = state.messages || Object.create(null);
        const m = msgs[p.messageId];
        if (m) {
            const toolIds = m.toolIds || [];
            msgs[p.messageId] = { ...m, toolIds: [...toolIds, p.toolId] };
            return { ...state, toolCalls: { ...calls, [p.toolId]: entry }, messages: msgs };
        }
    }
    return { ...state, toolCalls: { ...calls, [p.toolId]: entry } };
});

reg('tool_call:finished', (state, p) => {
    $err(p.toolId, 'tool_call:finished requires toolId');
    const calls = state.toolCalls || Object.create(null);
    const c = calls[p.toolId];
    $err(c, 'tool_call:finished for unknown toolId ' + p.toolId);
    return {
        ...state,
        toolCalls: { ...calls, [p.toolId]: { ...c, status: 'done', result: p.result, isError: p.isError || false } },
    };
});

// ── Session:creating alias (old protocol compat, delegates to pending_creation) ──

reg('session:message', (state, p) => {
    $err(p.sessionId, 'session:message requires sessionId');
    $err(p.role, 'session:message requires role');
    $err(p.content, 'session:message requires content');
    const s = state.runtime.sessions[p.sessionId];
    $err(s, 'session:message for unknown session ' + p.sessionId);
    const pendingMessages = s.pendingMessages || [];
    return {
        ...state,
        runtime: {
            ...state.runtime,
            sessions: {
                ...state.runtime.sessions,
                [p.sessionId]: {
                    ...s,
                    pendingMessages: [
                        ...pendingMessages,
                        { role: p.role, content: p.content, messageId: p.messageId || null },
                    ],
                },
            },
        },
    };
});

reg('config:capacity_changed', (state, p) => {
    return { ...state, config: { ...state.config, maxWorkers: p.maxWorkers } };
});

// Alias: old protocol event → new handler (single point of truth)
R['session:creating'] = R['session:pending_creation'];

export function applyEvent(state, type, payload) {
    const fn = R[type];
    return fn ? (fn(state, payload) ?? state) : state;
}

export function project(log) {
    let state = getInitialState();
    for (const e of log) state = applyEvent(state, e.event || e.type, e.payload);
    return state;
}
