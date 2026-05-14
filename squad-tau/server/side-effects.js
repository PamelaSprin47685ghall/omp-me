/**
 * Side-effect handlers — dumb muscle for the Event-Sourced Engine.
 *
 * Individual handler functions exported for direct use by the Engine.
 * No log-scanner (executeSideEffects), no isFulfilled — the Engine
 * routes Action[] directly to the appropriate handler.
 *
 * Session handles stored locally (cannot be serialized to EventLog).
 * Model pool acquisition is now a pure fact emitted by the Reactor —
 * SideEffects have zero knowledge of model pool.
 */
import { Events } from '../shared/events.js';
import { buildWorkerPrompt, buildConfirmPrompt } from './run-worker-prompt.js';
import { buildReviewerPrompt } from './run-reviewer-prompt.js';
import { buildOuterReviewPrompt } from './outer-review-prompt.js';
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
 * Create an LLM session for the given phase.
 * Appends SESSION_CREATING (transitional fact) before async API call,
 * then SESSION_START on success.
 *
 * @param {Function} getState — () => state for consistent state access
 */
export async function handleCreateSession({ nodeId, phase, slotId }, eventLog, pi, getState) {
    const { SessionManager } = await getCodingAgentModule();
    const state = getState();
    const node = state.squad.nodes.find((n) => n.id === nodeId);
    // Slot info from projected state (no ModelPool class needed)
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
 *
 * @param {Function} getState — () => state for consistent state access
 */
export async function handlePrompt({ sessionId, phase, nodeId }, eventLog, pi, getState) {
    const entry = sessionStore.get(sessionId);
    if (!entry) {
        console.error(`[SideEffects] Session ${sessionId} not found in store`);
        return;
    }

    const state = getState();
    const node = state.squad.nodes.find((n) => n.id === nodeId);
    let promptText = '';

    if (phase === 'authoring') {
        const upstreamResults = state.squad.nodes
            .filter((n) => (node?.depends_on || []).includes(n.id))
            .map((n) => ({
                nodeId: n.id,
                status: n.status,
                summary: n.summary,
                affectedFiles: n.affectedFiles,
            }));
        const history = node?.history || [];
        promptText = buildWorkerPrompt(node || { task: '' }, upstreamResults, history);
    } else if (phase === 'confirming') {
        promptText = buildConfirmPrompt(node || { task: '' });
    } else if (phase === 'reviewer') {
        const history = node?.history || [];
        const workerSession = Object.values(state.sessions).find(
            (s) => s.nodeId === nodeId && s.role === 'worker_confirm',
        );
        const workerReturnMsg = workerSession?.messages?.find((m) =>
            m.content?.some((c) => c.type === 'tool_call' && c.toolName === 'return'),
        );
        const workerReturnParams = workerReturnMsg?.content?.find((c) => c.type === 'tool_call')?.params;
        const workerResult = workerReturnParams || {
            status: 'ok',
            reason: 'Initial submission',
            affected_files: [],
        };
        promptText = buildReviewerPrompt({
            node: node || { task: '' },
            workerResult,
            iterationHistory: history,
        });
    } else if (phase === 'outer_review') {
        const allNodeResults = state.squad.nodes.map((n) => ({
            id: n.id,
            status: n.status,
            summary: n.summary,
            affectedFiles: n.affectedFiles,
        }));
        promptText = buildOuterReviewPrompt(
            state.squad.originalTask,
            allNodeResults,
            state.squad.outerReview?.round || 1,
        );
    }

    if (promptText) {
        entry.session.prompt(promptText);
    }
}

/**
 * Forward a user message to an active LLM session.
 * Called by the Engine pulse when it detects session:user_message_received events.
 */
export async function handleUserMessage({ sessionId, text, messageId }) {
    const entry = sessionStore.get(sessionId);
    if (!entry || entry.status !== 'active') return;
    await entry.sendUserMessage(text);
}
