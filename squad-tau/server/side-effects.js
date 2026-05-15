/**
 * Side-effect handlers — dumb muscle for the Event-Sourced Engine.
 *
 * Routing Matrix (Cut 3): Effects = { [eventType]: handler }
 * No switch/case. No slot management (Cut 1).
 */
import { PromptDoc, PROMPT_TEMPLATES } from './prompt-builder.js';

const sessionStore = new Map();

export async function getCodingAgentModule() {
    return (await import('@oh-my-pi/resolve-pi')).getCodingAgentModule();
}

const Effects = {};

function register(event) {
    return (fn) => {
        Effects[event] = fn;
    };
}

register('session:creating')(async (payload, { eventLog, pi, getState }) => {
    try {
        await handleCreateSession(payload, eventLog, pi, getState);
    } catch (err) {
        console.error(`[SideEffects] createSession failed:`, err);
    }
});

register('session:prompting')(async (payload, { eventLog, pi, getState }) => {
    try {
        await handlePrompt(payload, eventLog, pi, getState);
    } catch (err) {
        console.error(`[SideEffects] sendPrompt failed:`, err);
    }
});

register('session:message')(async (payload, { eventLog, pi, getState }) => {
    try {
        if (payload.role === 'user') {
            await handleUserMessage(payload);
        }
    } catch (err) {
        console.error(`[SideEffects] userMessage failed:`, err);
    }
});

register('squad:complete')(() => sessionStore.clear());
register('squad:abort')(() => sessionStore.clear());

export function setupSideEffects(eventLog, pi, getState) {
    const unsub = eventLog.subscribe((entry) => {
        const handler = Effects[entry.event];
        if (handler) handler(entry.payload, { eventLog, pi, getState });
    });
    return unsub;
}

async function handleCreateSession({ nodeId, sessionId, phase, retryCount }, eventLog, pi, getState) {
    const { SessionManager } = await getCodingAgentModule();
    const state = getState();
    const node = state.squad.nodes[nodeId];
    const options = buildWorkerSessionOptions(pi, {
        provider: 'test',
        modelId: 'default',
    });
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd) };

    const { session } = await pi.pi.createAgentSession(sessionOpts);
    const actualSessionId = session.sessionFile;

    sessionStore.set(actualSessionId, {
        session,
        status: 'active',
    });

    if (actualSessionId !== sessionId) {
        sessionStore.set(sessionId, sessionStore.get(actualSessionId));
    }

    eventLog.append('session:start', {
        sessionId,
        nodeId,
        phase,
        retryCount,
        model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
    });

    subscribeToSessionEvents(session, eventLog, sessionId);
}

async function handlePrompt({ sessionId, phase, nodeId }, eventLog, pi, getState) {
    const entry = sessionStore.get(sessionId);
    if (!entry) {
        console.error(`[SideEffects] Session ${sessionId} not found in store`);
        return;
    }
    const state = getState();
    const node = state.squad.nodes[nodeId];
    if (PROMPT_TEMPLATES[phase]) {
        const promptText = new PromptDoc(PROMPT_TEMPLATES[phase](state, node || { task: '' })).compile();
        entry.session.prompt(promptText);
    }
}

async function handleUserMessage({ sessionId, text, messageId }) {
    const entry = sessionStore.get(sessionId);
    if (!entry || entry.status !== 'active') return;
    await entry.session.prompt(text);
}

function buildBaseSessionOptions(pi, modelSlot) {
    const options = { cwd: process.cwd(), hasUI: false };
    const tl = pi?.getThinkingLevel?.();
    if (tl) options.thinkingLevel = tl;
    if (modelSlot) {
        options.model = { provider: modelSlot.provider, id: modelSlot.modelId };
        if (modelSlot.thinkingLevel) options.thinkingLevel = modelSlot.thinkingLevel;
    }
    return options;
}

function buildWorkerSessionOptions(pi, modelSlot) {
    const options = buildBaseSessionOptions(pi, modelSlot);
    const activeTools = pi?.getActiveTools?.()?.filter((t) => t !== 'delegate') ?? [];
    if (activeTools.length > 0)
        options.toolNames = activeTools.includes('return') ? activeTools : [...activeTools, 'return'];
    return options;
}

const SessionEventHandlers = {
    message_update: handleMessageUpdate,
    tool_execution_start: handleToolStart,
    tool_execution_end: handleToolEnd,
    message_end: handleMessageEnd,
};

function subscribeToSessionEvents(session, eventLog, sessionId) {
    return session.subscribe((event) => {
        try {
            const handler = SessionEventHandlers[event.type];
            if (handler) handler(event, eventLog, sessionId);
        } catch (err) {
            console.error(`[SessionEvents] Error ${event.type} for ${sessionId}:`, err);
        }
    });
}

function handleMessageUpdate(event, eventLog, sessionId) {
    const ae = event.assistantMessageEvent;
    if (!ae || !event.message || !event.message.id) return;
    const t = ae.type === 'thinking_delta' ? 'thinking_delta' : 'text_delta';
    eventLog.append('session:message_delta', {
        sessionId,
        messageId: event.message.id,
        delta: { type: t, text: ae.delta },
    });
}

function handleToolStart(event, eventLog, sessionId) {
    eventLog.append('session:tool_call', {
        sessionId,
        toolName: event.toolName,
        toolId: event.toolId,
        params: event.input,
    });
}

function handleToolEnd(event, eventLog, sessionId) {
    eventLog.append('session:tool_result', {
        sessionId,
        toolId: event.toolId,
        result: event.result,
        isError: event.isError || false,
    });
}

function handleMessageEnd(event, eventLog, sessionId) {
    eventLog.append('session:message', {
        sessionId,
        role: event.message.role,
        content: event.message.content,
        messageId: event.message.id,
        parentId: event.message.parentId,
    });
}
