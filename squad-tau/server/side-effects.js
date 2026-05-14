/**
 * Side-effect handlers — dumb muscle for the Event-Sourced Engine.
 *
 * Subscription-based: `setupSideEffects()` registers EventLog listeners.
 * When the Reactor emits a fact that requires async work (SESSION_CREATING,
 * SESSION_PROMPTING), the subscriber fires the appropriate handler.
 *
 * Session handles stored locally (cannot be serialized to EventLog).
 */
import { PromptDoc, PROMPT_TEMPLATES } from './prompt-builder.js';
import { Events } from '../shared/events.js';

export const sessionStore = new Map();

export function getSessionEntry(sessionId) {
    return sessionStore.get(sessionId) || null;
}

export async function getCodingAgentModule() {
    return (await import('@oh-my-pi/resolve-pi')).getCodingAgentModule();
}

/**
 * Wire side-effect handlers as EventLog subscribers.
 * The Engine calls this once during setup.
 *
 * @param {Object} eventLog  — EventLog instance
 * @param {Object} pi        — PI coding agent module
 * @param {Function} getState — () => state for consistent state access
 * @returns {Function} cleanup function
 */
export function setupSideEffects(eventLog, pi, getState) {
    const unsub = eventLog.subscribe((entry) => {
        const { event, payload } = entry;

        try {
            if (event === Events.SESSION_CREATING) {
                handleCreateSession(payload, eventLog, pi, getState).catch((err) => {
                    console.error(`[SideEffects] createSession failed:`, err);
                    const node = getState().squad.nodes.find((n) => n.id === payload.nodeId);
                    if (node) node.sessionStatus = 'none';
                });
            } else if (event === Events.SESSION_PROMPTING) {
                handlePrompt(payload, eventLog, pi, getState).catch((err) =>
                    console.error(`[SideEffects] sendPrompt failed:`, err),
                );
            } else if (event === 'session:user_message_received') {
                handleUserMessage(payload).catch((err) => console.error(`[SideEffects] userMessage failed:`, err));
            }
        } catch (err) {
            console.error(`[SideEffects] unhandled error processing ${event}:`, err);
        }
    });

    return unsub;
}

/**
 * Create an LLM session for the given phase.
 */
export async function handleCreateSession({ nodeId, phase, slotId }, eventLog, pi, getState) {
    const { SessionManager } = await getCodingAgentModule();
    const state = getState();
    const node = state.squad.nodes.find((n) => n.id === nodeId);
    const slot = slotId ? state.modelPool.slots.find((s) => s.slotId === slotId) : undefined;

    const options = buildWorkerSessionOptions(
        { originalTask: state.squad.originalTask },
        pi,
        slot || { provider: 'test', modelId: 'default' },
    );
    const sessionOpts = {
        ...options,
        sessionManager: SessionManager.create(options.cwd),
    };

    const { session } = await pi.pi.createAgentSession(sessionOpts);
    const sessionId = session.sessionFile;

    sessionStore.set(sessionId, {
        sendUserMessage: (text) => session.prompt(text),
        session,
        status: 'active',
    });

    eventLog.append(Events.SESSION_START, {
        sessionId,
        nodeId,
        phase,
        model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
    });

    subscribeToSessionEvents(session, eventLog, sessionId);
}

/**
 * Send a prompt to an existing session.
 */
export async function handlePrompt({ sessionId, phase, nodeId }, eventLog, pi, getState) {
    const entry = sessionStore.get(sessionId);
    if (!entry) {
        console.error(`[SideEffects] Session ${sessionId} not found in store`);
        return;
    }

    const state = getState();
    const node = state.squad.nodes.find((n) => n.id === nodeId);

    const phaseKey = phase === 'authoring' ? 'worker' : phase;
    if (PROMPT_TEMPLATES[phaseKey]) {
        const promptText = new PromptDoc(PROMPT_TEMPLATES[phaseKey](state, node || { task: '' })).compile();
        entry.session.prompt(promptText);
    }
}

/**
 * Forward a user message to an active LLM session.
 */
export async function handleUserMessage({ sessionId, text, messageId }) {
    const entry = sessionStore.get(sessionId);
    if (!entry || entry.status !== 'active') return;
    await entry.sendUserMessage(text);
}

// ── Inlined from session-options.js ──

function buildBaseSessionOptions(ctx, pi, modelSlot) {
    const options = {
        cwd: ctx?.cwd ?? process.cwd(),
        hasUI: false,
    };

    if (ctx?.agentsMdSearch) options.agentsMdSearch = ctx.agentsMdSearch;
    if (ctx?.workspaceTree) options.workspaceTree = ctx.workspaceTree;

    if (ctx?.modelRegistry) options.modelRegistry = ctx.modelRegistry;
    if (ctx?.model) options.model = ctx.model;

    if (modelSlot) {
        const available = ctx?.modelRegistry?.getAvailable?.() ?? [];
        const matched = available.find((m) => m.provider === modelSlot.provider && m.id === modelSlot.modelId);
        if (matched) {
            options.model = matched;
            if (modelSlot.thinkingLevel) options.thinkingLevel = modelSlot.thinkingLevel;
        }
    }

    if (ctx?.getThinkingLevel) {
        const level = ctx.getThinkingLevel();
        if (level && !options.thinkingLevel) options.thinkingLevel = level;
    }

    if (ctx?.getSystemPrompt) {
        options.systemPrompt = ctx.getSystemPrompt();
    }

    return options;
}

function buildWorkerSessionOptions(ctx, pi, modelSlot) {
    const options = buildBaseSessionOptions(ctx, pi, modelSlot);

    const activeTools = (ctx?.session?.getActiveToolNames?.() ?? pi?.getActiveTools?.())?.filter(
        (t) => t !== 'delegate',
    );
    if (activeTools?.length > 0) {
        options.toolNames = activeTools.includes('return') ? activeTools : [...activeTools, 'return'];
    }

    return options;
}

// ── Inlined from session-events.js ──

function subscribeToSessionEvents(session, eventLog, sessionId) {
    return session.subscribe((event) => {
        try {
            if (event.type === 'message_update') {
                handleMessageUpdate(event, eventLog, sessionId);
            } else if (event.type === 'tool_execution_start') {
                handleToolStart(event, eventLog, sessionId);
            } else if (event.type === 'tool_execution_end') {
                handleToolEnd(event, eventLog, sessionId);
            } else if (event.type === 'message_end') {
                handleMessageEnd(event, eventLog, sessionId);
            }
        } catch (err) {
            console.error(`[SessionEvents] Error handling event ${event.type} for ${sessionId}:`, err);
        }
    });
}

function handleMessageUpdate(event, eventLog, sessionId) {
    const assistantEvent = event.assistantMessageEvent;
    if (!assistantEvent || !event.message || !event.message.id) return;
    if (assistantEvent.type === 'text_delta') {
        eventLog.append(Events.SESSION_MESSAGE_DELTA, {
            sessionId,
            messageId: event.message.id,
            delta: { type: 'text_delta', text: assistantEvent.delta },
        });
    } else if (assistantEvent.type === 'thinking_delta') {
        eventLog.append(Events.SESSION_MESSAGE_DELTA, {
            sessionId,
            messageId: event.message.id,
            delta: { type: 'thinking_delta', text: assistantEvent.delta },
        });
    }
}

function handleToolStart(event, eventLog, sessionId) {
    eventLog.append(Events.SESSION_TOOL_CALL, {
        sessionId,
        toolName: event.toolName,
        toolId: event.toolId,
        params: event.input,
    });
}

function handleToolEnd(event, eventLog, sessionId) {
    eventLog.append(Events.SESSION_TOOL_RESULT, {
        sessionId,
        toolId: event.toolId,
        result: event.result,
        isError: event.isError || false,
    });
}

function handleMessageEnd(event, eventLog, sessionId) {
    eventLog.append(Events.SESSION_MESSAGE, {
        sessionId,
        role: event.message.role,
        content: event.message.content,
        messageId: event.message.id,
        parentId: event.message.parentId,
    });
}
