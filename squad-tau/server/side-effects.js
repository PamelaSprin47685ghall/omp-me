/**
 * Side-effect handlers — dumb muscle for the Event-Sourced Engine.
 *
 * Routing Matrix: Effects = { [eventType]: handler }
 * No switch/case. No slot management.
 * Emits domain events: message:delta, message:finalized, tool_call:started, tool_call:finished
 */
import { buildPrompt } from './prompt-builder.js';

const sessionStore = new Map();

export async function getCodingAgentModule() {
    return (await import('@oh-my-pi/resolve-pi')).getCodingAgentModule();
}

export const DefaultEffects = {};

function register(event) {
    return (fn) => {
        DefaultEffects[event] = fn;
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
        await handlePromptSession(payload, eventLog, pi, getState);
    } catch (err) {
        console.error(`[SideEffects] sendPrompt failed:`, err);
    }
});

register('session:message')(async (payload, { eventLog, pi, getState }) => {
    try {
        if (payload.role === 'user') {
            const messageId = payload.messageId || `usr_${Date.now()}`;
            eventLog.append('message:created', {
                messageId,
                sessionId: payload.sessionId,
                role: 'user',
            });
            eventLog.append('message:finalized', {
                messageId,
                staticContent: extractText(payload.content),
            });
            await handleUserMessage(payload);
        }
    } catch (err) {
        console.error(`[SideEffects] userMessage failed:`, err);
    }
});

register('squad:complete')(() => sessionStore.clear());
register('squad:abort')(() => sessionStore.clear());

export function setupSideEffects(eventLog, pi, getState, effects = null) {
    const effectMap = effects || DefaultEffects;
    const unsub = eventLog.subscribe((entry) => {
        const handler = effectMap[entry.event];
        if (handler) handler(entry.payload, { eventLog, pi, getState });
    });
    return unsub;
}

async function handleCreateSession({ nodeId, sessionId, phase, retryCount }, eventLog, pi, getState) {
    const { SessionManager } = await getCodingAgentModule();
    const state = getState();
    const node = state.squad.nodes[nodeId];
    const options = buildWorkerSessionOptions(pi, { provider: 'test', modelId: 'default' });
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd) };

    const { session } = await pi.pi.createAgentSession(sessionOpts);
    const actualSessionId = session.sessionFile;

    sessionStore.set(actualSessionId, { session, status: 'active' });
    if (actualSessionId !== sessionId) sessionStore.set(sessionId, sessionStore.get(actualSessionId));

    eventLog.append('session:start', {
        sessionId,
        nodeId,
        phase,
        retryCount,
        model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
    });

    subscribeToSessionEvents(session, eventLog, sessionId);
}

async function handlePromptSession({ sessionId, phase, nodeId }, eventLog, pi, getState) {
    const entry = sessionStore.get(sessionId);
    if (!entry) return;
    const state = getState();
    const node = state.squad.nodes[nodeId];
    if (node && phase) {
        const promptText = buildPrompt(phase, state, node);
        if (promptText) entry.session.prompt(promptText);
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

// Map OMP session events to domain events
const SessionEventHandlers = {
    message_update: handleMessageUpdate,
    tool_execution_start: handleToolStart,
    tool_execution_end: handleToolEnd,
    message_end: handleMessageEnd,
};

/**
 * Track which messageIds we've already emitted message:created for.
 * First delta for a new messageId triggers message:created fact.
 */
const seenMessages = new Map(); // sessionId -> Set<messageId>

function subscribeToSessionEvents(session, eventLog, sessionId) {
    if (!seenMessages.has(sessionId)) seenMessages.set(sessionId, new Set());
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

    // First delta for this messageId emits message:created fact
    const sessionSeen = seenMessages.get(sessionId);
    if (!sessionSeen.has(event.message.id)) {
        sessionSeen.add(event.message.id);
        eventLog.append('message:created', {
            messageId: event.message.id,
            sessionId,
            role: 'assistant',
        });
    }

    const deltaType = ae.type === 'thinking_delta' ? 'thinking' : 'text';
    eventLog.append('message:delta', {
        sessionId,
        messageId: event.message.id,
        delta: { type: deltaType, text: ae.delta },
    });
}

function handleToolStart(event, eventLog, sessionId) {
    eventLog.append('tool_call:started', {
        toolId: event.toolId,
        sessionId,
        toolName: event.toolName,
        params: event.input,
    });
}

function handleToolEnd(event, eventLog, sessionId) {
    eventLog.append('tool_call:finished', {
        toolId: event.toolId,
        result: event.result,
        isError: event.isError ?? false,
    });
}

function handleMessageEnd(event, eventLog, sessionId) {
    eventLog.append('message:finalized', {
        messageId: event.message.id,
        staticContent: extractText(event.message.content),
    });
}

function extractText(content) {
    if (!content) return '';
    const blocks = Array.isArray(content) ? content : [content];
    const tb = blocks.find((b) => b.type === 'text');
    return tb ? tb.text : '';
}
