export const INITIAL_STATE = {
    sessions: new Map(),
    messages: new Map(),
};

function handleSessionStart(state, payload) {
    const { sessionId, nodeId, phase, retryCount, model } = payload;
    const sessions = new Map(state.sessions);
    sessions.set(sessionId, { sessionId, nodeId, phase, retryCount, model, status: 'active' });
    const messages = new Map(state.messages);
    if (!messages.has(sessionId)) messages.set(sessionId, []);
    return { ...state, sessions, messages };
}

function handleSessionStateChange(state, payload) {
    const { sessionId, phase } = payload;
    const sessions = new Map(state.sessions);
    const session = sessions.get(sessionId);
    if (session) {
        const status = ['completed', 'aborted', 'error'].includes(phase) ? phase : session.status;
        sessions.set(sessionId, { ...session, phase, status });
    }
    return { ...state, sessions };
}

function handleSessionMessage(state, payload) {
    const { sessionId, role, content, messageId, parentId } = payload;
    const messages = new Map(state.messages);
    const list = messages.get(sessionId) || [];

    // Deduplicate by messageId (server echoes back the same messageId we sent)
    const existingIdx = list.findIndex((msg) => msg.messageId === messageId);

    if (existingIdx !== -1) {
        const updated = list.map((msg, i) =>
            i === existingIdx ? { ...msg, role, content, parentId, messageId, streaming: false } : msg,
        );
        messages.set(sessionId, updated);
    } else {
        messages.set(sessionId, [...list, { role, content, messageId, parentId, streaming: false }]);
    }
    return { ...state, messages };
}

function appendDeltaBlock(content, delta) {
    const blockType = delta.type === 'text_delta' ? 'text' : 'thinking';
    const existingIdx = content.findIndex((b) => b.type === blockType);
    if (existingIdx !== -1) {
        return content.map((b, i) => (i === existingIdx ? { ...b, text: b.text + delta.text } : b));
    }
    return [...content, { type: blockType, text: delta.text }];
}

function handleSessionMessageDelta(state, payload) {
    const { sessionId, delta, messageId } = payload;
    const messages = new Map(state.messages);
    const list = messages.get(sessionId) || [];
    const msgIdx = list.findIndex((msg) => msg.messageId === messageId);

    if (msgIdx !== -1) {
        const updated = list.map((msg, i) =>
            i === msgIdx ? { ...msg, content: appendDeltaBlock(msg.content, delta), streaming: true } : msg,
        );
        messages.set(sessionId, updated);
    } else {
        const blockType = delta.type === 'text_delta' ? 'text' : 'thinking';
        messages.set(sessionId, [
            ...list,
            { role: 'assistant', messageId, content: [{ type: blockType, text: delta.text }], streaming: true },
        ]);
    }
    return { ...state, messages };
}

function handleSessionToolCall(state, payload) {
    const { sessionId, toolName, toolId, params } = payload;
    const messages = new Map(state.messages);
    const list = messages.get(sessionId) || [];
    const existingIdx = list.findIndex((msg) => msg.messageId === toolId);
    if (existingIdx !== -1) {
        const updated = list.map((msg, i) =>
            i === existingIdx ? { ...msg, content: [{ type: 'tool_call', toolName, toolId, params }] } : msg,
        );
        messages.set(sessionId, updated);
    } else {
        messages.set(sessionId, [
            ...list,
            { role: 'assistant', messageId: toolId, content: [{ type: 'tool_call', toolName, toolId, params }] },
        ]);
    }
    return { ...state, messages };
}

function handleSessionToolResult(state, payload) {
    const { sessionId, toolId, result, isError } = payload;
    const messages = new Map(state.messages);
    const list = messages.get(sessionId);
    if (!list) return state;
    const msgIdx = list.findIndex((msg) => msg.messageId === toolId);
    if (msgIdx === -1) return state;
    const updated = list.map((msg, i) => {
        if (i !== msgIdx) return msg;
        const content = msg.content.map((b) =>
            b.type === 'tool_call' && b.toolId === toolId ? { ...b, result, isError } : b,
        );
        return { ...msg, content };
    });
    messages.set(sessionId, updated);
    return { ...state, messages };
}

function handleSessionEnd(state, payload) {
    const { sessionId, reason, errorMessage } = payload;
    const sessions = new Map(state.sessions);
    const session = sessions.get(sessionId);
    if (session) sessions.set(sessionId, { ...session, status: reason, errorMessage });
    return { ...state, sessions };
}

const HANDLERS = {
    SESSION_START: handleSessionStart,
    SESSION_STATE: handleSessionStateChange,
    SESSION_MESSAGE: handleSessionMessage,
    SESSION_MESSAGE_DELTA: handleSessionMessageDelta,
    SESSION_TOOL_CALL: handleSessionToolCall,
    SESSION_TOOL_RESULT: handleSessionToolResult,
    SESSION_END: handleSessionEnd,
};

export function sessionReducer(state, action) {
    const handler = HANDLERS[action.type];
    return handler ? handler(state, action.payload) : state;
}
