/**
 * Homomorphic event projections — shared between client and server.
 * v9: Structural sharing, no latestReturn, no defensive defaults, no retryCount compat.
 * squad:init computes initial wavefront (deps-met nodes get 'authoring' directly).
 * Domain facts (node:work_submitted, node:review_decided) replace raw tool return plumbing.
 * State only contains dynamic runtime fields.
 *
 * No .find() / .findIndex() — O(1) hash lookups only.
 * No fallbacks — fail fast on contract violation.
 */

function invariant(cond, msg) {
    if (!cond) throw new Error(`[Projection] ${msg}`);
}

function setIn(state, keys, value) {
    if (keys.length === 0) return value;
    const [key, ...rest] = keys;
    const prev = state[key];
    const next = Array.isArray(prev) && keys.length === 1 ? value : setIn(prev, rest, value);
    if (prev === next) return state;
    return { ...state, [key]: next };
}

const Reducers = {};

function register(type) {
    return (fn) => {
        Reducers[type] = fn;
    };
}

export function getInitialState() {
    return {
        squad: {
            status: 'idle',
            nodes: {},
            results: [],
            originalTask: '',
            mode: 'M',
            planConfig: null,
            mainSessionId: null,
        },
        sessions: {},
        messages: {},
        toolCalls: {},
        config: { maxWorkers: 3 },
    };
}

// ── Message Lifecycle ──

register('message:created')((state, payload) => {
    const { messageId, sessionId, role, parentId, staticContent } = payload;
    invariant(sessionId, 'message:created requires sessionId');
    invariant(messageId, 'message:created requires messageId');
    const session = state.sessions[sessionId];
    invariant(session, `message:created references nonexistent session ${sessionId}`);

    const msg = {
        messageId,
        sessionId,
        role,
        status: 'created',
        parentId,
        staticContent,
        toolIds: [],
        contentBlocks: null,
        blocks: role === 'assistant' ? [{ type: 'text', id: messageId }] : [],
    };
    const newMessages = { ...state.messages, [messageId]: msg };
    const newSession = { ...session, messageIds: [...session.messageIds, messageId] };
    const newSessions = { ...state.sessions, [sessionId]: newSession };
    return { ...state, messages: newMessages, sessions: newSessions };
});

register('message:finalized')((state, payload) => {
    const msg = state.messages[payload.messageId];
    invariant(msg, `message:finalized references nonexistent message ${payload.messageId}`);
    if (msg.status === 'finalized' && msg.staticContent === payload.staticContent) return state;
    const newMsg = { ...msg, status: 'finalized' };
    if (payload.staticContent !== undefined) newMsg.staticContent = payload.staticContent;
    if (payload.contentBlocks !== undefined) newMsg.contentBlocks = payload.contentBlocks;
    // Derive blocks array from contentBlocks when present (preserves text↔tool ordering).
    // Uses the same ID scheme as the streaming phase (tool_call:started projection)
    // so React elements maintain identity across the streaming→finalized transition.
    if (Array.isArray(payload.contentBlocks)) {
        newMsg.blocks = [];
        let lastToolId = null;
        for (const b of payload.contentBlocks) {
            if (b.type === 'text') {
                const id = lastToolId ? `${payload.messageId}_after_${lastToolId}` : payload.messageId;
                newMsg.blocks.push({ type: 'text', id });
            } else if (b.type === 'tool_use') {
                newMsg.blocks.push({ type: 'tool', id: b.id, toolName: b.name });
                lastToolId = b.id;
            } else {
                newMsg.blocks.push({ type: b.type, id: b.id || `${payload.messageId}_b${newMsg.blocks.length}` });
            }
        }
    }
    return setIn(state, ['messages', payload.messageId], newMsg);
});

// ── Tool Call Lifecycle ──

register('tool_call:started')((state, payload) => {
    const { sessionId, toolId, toolName, params, messageId } = payload;
    const tc = {
        toolId,
        sessionId,
        messageId: messageId || '',
        toolName,
        params,
        result: undefined,
        isError: undefined,
    };
    let st = setIn(state, ['toolCalls', toolId], tc);

    if (messageId && st.messages[messageId]) {
        const msg = st.messages[messageId];
        const newBlocks = [
            ...msg.blocks,
            { type: 'tool', id: toolId, toolName },
            { type: 'text', id: `${messageId}_after_${toolId}` },
        ];
        st = setIn(st, ['messages', messageId], {
            ...msg,
            toolIds: [...msg.toolIds, toolId],
            blocks: newBlocks,
        });
    }

    // LatestReturn removed — domain facts (node:work_submitted, node:review_decided)
    // are now produced by side-effects handleToolEnd instead.

    return st;
});

register('tool_call:finished')((state, payload) => {
    const tc = state.toolCalls[payload.toolId];
    invariant(tc, `tool_call:finished references nonexistent tool call ${payload.toolId}`);
    if (tc.result === payload.result && tc.isError === (payload.isError === true)) return state;
    return setIn(state, ['toolCalls', payload.toolId], {
        ...tc,
        result: payload.result,
        isError: payload.isError === true,
    });
});

// ── Squad Lifecycle ──

register('squad:register_main_session')((state, payload) => {
    return setIn(state, ['squad', 'mainSessionId'], payload.sessionId);
});

register('squad:init')((state, payload) => {
    const nodes = {};
    const workerIds = [];
    const planConfig = {};

    for (const n of payload.nodes || []) {
        const nodeId = n.id;
        // Initial wavefront: nodes with no dependencies start directly in 'authoring'
        const deps = n.depends_on || [];
        const initialStatus = deps.length === 0 ? 'authoring' : undefined;
        nodes[nodeId] = {
            id: nodeId,
            depends_on: deps,
            status: initialStatus,
            epoch: 0,
            summary: undefined,
            feedback: undefined,
            affectedFiles: undefined,
            lastPromptedPhase: null,
        };
        workerIds.push(nodeId);
        // Static topology metadata stored in planConfig, not in nodes
        planConfig[nodeId] = {
            task: n.task || '',
            review_criteria: n.review_criteria || [],
            phases: ['authoring', 'confirming', 'reviewing'],
            maxRetries: 5,
            resetOnRej: false,
        };
    }

    // L mode: inject __or__ outer review node
    if (payload.mode === 'L') {
        const orId = '__or__';
        nodes[orId] = {
            id: orId,
            depends_on: [...workerIds],
            status: undefined,
            epoch: 0,
            summary: undefined,
            feedback: undefined,
            affectedFiles: undefined,
            lastPromptedPhase: null,
        };
        planConfig[orId] = {
            task: payload.originalTask || '',
            review_criteria: [],
            phases: ['reviewing'],
            maxRetries: Infinity,
            resetOnRej: true,
        };
    }

    return {
        ...getInitialState(),
        config: state.config,
        squad: {
            status: 'active',
            mode: payload.mode,
            nodes,
            planConfig,
            originalTask: payload.originalTask || '',
            results: [],
            mainSessionId: payload.mainSessionId || null,
        },
    };
});

register('squad:node_state')((state, payload) => {
    const node = state.squad.nodes[payload.nodeId];
    invariant(node, `squad:node_state references nonexistent node ${payload.nodeId}`);
    const newNode = { ...node, ...payload };
    return setIn(state, ['squad', 'nodes', payload.nodeId], newNode);
});

register('squad:complete')((state, payload) => {
    return { ...state, squad: { ...state.squad, status: 'complete', results: payload.results } };
});

register('squad:abort')((state) => {
    return { ...state, squad: { ...state.squad, status: 'aborted' } };
});

register('squad:phase_changed')((state, payload) => {
    return {
        ...state,
        squad: {
            ...state.squad,
            phase: payload.phase,
            feedback: payload.feedback,
        },
    };
});

register('squad:replan')((state, payload) => {
    const nodes = {};
    const workerIds = [];
    const planConfig = {};

    for (const n of payload.nodes || []) {
        const nodeId = n.id;
        const deps = n.depends_on || [];
        const initialStatus = deps.length === 0 ? 'authoring' : undefined;
        nodes[nodeId] = {
            id: nodeId,
            depends_on: deps,
            status: initialStatus,
            epoch: 0,
            summary: undefined,
            feedback: undefined,
            affectedFiles: undefined,
            lastPromptedPhase: null,
        };
        workerIds.push(nodeId);
        planConfig[nodeId] = {
            task: n.task || '',
            review_criteria: n.review_criteria || [],
            phases: ['authoring', 'confirming', 'reviewing'],
            maxRetries: 5,
            resetOnRej: false,
        };
    }

    if (payload.mode === 'L') {
        const orId = '__or__';
        nodes[orId] = {
            id: orId,
            depends_on: [...workerIds],
            status: undefined,
            epoch: 0,
            summary: undefined,
            feedback: undefined,
            affectedFiles: undefined,
            lastPromptedPhase: null,
        };
        planConfig[orId] = {
            task: payload.originalTask || '',
            review_criteria: [],
            phases: ['reviewing'],
            maxRetries: Infinity,
            resetOnRej: true,
        };
    }

    return {
        ...state,
        squad: {
            ...state.squad,
            status: 'active',
            phase: undefined,
            feedback: undefined,
            mode: payload.mode,
            nodes,
            planConfig,
            originalTask: payload.originalTask || '',
            results: [],
            mainSessionId: payload.mainSessionId || null,
        },
    };
});

// ── Domain Facts (elevated from raw tool_call return plumbing) ──

register('node:work_submitted')((state, payload) => {
    const node = state.squad.nodes[payload.nodeId];
    invariant(node, `node:work_submitted references nonexistent node ${payload.nodeId}`);
    const cfg = state.squad.planConfig?.[payload.nodeId];
    invariant(cfg, `node:work_submitted: no planConfig for ${payload.nodeId}`);
    const phases = cfg.phases;
    invariant(phases, `node:work_submitted: no phases in planConfig for ${payload.nodeId}`);
    const currentIdx = phases.indexOf(node.status);
    const nextStatus = currentIdx >= 0 && currentIdx < phases.length - 1 ? phases[currentIdx + 1] : null;
    const newNode = {
        ...node,
        summary: payload.summary,
        affectedFiles: payload.affected_files || [],
    };
    if (nextStatus) newNode.status = nextStatus;
    return setIn(state, ['squad', 'nodes', payload.nodeId], newNode);
});

register('node:review_decided')((state, payload) => {
    const node = state.squad.nodes[payload.nodeId];
    invariant(node, `node:review_decided references nonexistent node ${payload.nodeId}`);
    if (payload.approved) {
        return setIn(state, ['squad', 'nodes', payload.nodeId], {
            ...node,
            status: 'approved',
            summary: payload.summary,
            affectedFiles: payload.affectedFiles || [],
        });
    }
    return setIn(state, ['squad', 'nodes', payload.nodeId], {
        ...node,
        status: 'rejected',
        feedback: payload.summary || '',
        epoch: payload.epoch ?? node.epoch,
    });
});

// ── Config Domain Facts ──

register('config:capacity_changed')((state, payload) => {
    if (!state.config) state = { ...state, config: { maxWorkers: 3 } };
    return setIn(state, ['config', 'maxWorkers'], payload.maxWorkers);
});

// ── Session Lifecycle ──

register('session:creating')((state, payload) => {
    const { sessionId, nodeId, phase, epoch } = payload;
    invariant(epoch !== undefined, 'session:creating requires epoch');
    const sess = {
        sessionId,
        nodeId,
        phase,
        role: phase,
        status: 'creating',
        messageIds: [],
        epoch,
    };
    return setIn(state, ['sessions', payload.sessionId], sess);
});

register('session:start')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:start references nonexistent session ${payload.sessionId}`);
    const epoch = payload.epoch;
    invariant(epoch !== undefined, 'session:start requires epoch');
    return setIn(state, ['sessions', payload.sessionId], {
        ...sess,
        status: 'active',
        model: payload.model,
        epoch,
    });
});

register('session:prompting')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:prompting references nonexistent session ${payload.sessionId}`);
    if (sess.lastPromptedPhase === payload.phase) return state;
    return setIn(state, ['sessions', payload.sessionId], { ...sess, lastPromptedPhase: payload.phase });
});

register('session:state')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:state references nonexistent session ${payload.sessionId}`);
    const terminalStatus = ['completed', 'aborted', 'error'];
    const newStatus = terminalStatus.includes(payload.phase) ? payload.phase : 'active';
    if (sess.phase === payload.phase && sess.status === newStatus) return state;
    return setIn(state, ['sessions', payload.sessionId], { ...sess, phase: payload.phase, status: newStatus });
});

register('session:end')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:end references nonexistent session ${payload.sessionId}`);
    const upd = { ...sess, status: payload.reason || 'completed' };
    if (payload.errorMessage) upd.errorMessage = payload.errorMessage;
    if (sess.status === upd.status && !payload.errorMessage) return state;
    return setIn(state, ['sessions', payload.sessionId], upd);
});

// ── First-Class Faults ──

register('session:faulted')((state, payload) => {
    const sess = state.sessions[payload.sessionId];
    invariant(sess, `session:faulted references nonexistent session ${payload.sessionId}`);
    return setIn(state, ['sessions', payload.sessionId], {
        ...sess,
        status: 'faulted',
        faultReason: payload.reason,
        faultMessage: payload.message,
    });
});

// ── Dispatch ──

export function applyEvent(state, type, payload) {
    const reducer = Reducers[type];
    if (!reducer) return state;
    return reducer(state, payload) ?? state;
}

export function fold(state, entry) {
    return applyEvent(structuredClone(state), entry.event || entry.type, entry.payload);
}

export function project(log) {
    let state = getInitialState();
    for (const entry of log) {
        state = applyEvent(state, entry.event || entry.type, entry.payload);
    }
    return state;
}
