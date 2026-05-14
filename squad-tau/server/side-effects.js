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
import { buildWorkerSessionOptions } from './session-options.js';
import { subscribeToSessionEvents } from './session-events.js';

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
