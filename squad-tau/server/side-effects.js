/**
 * Side-effect handlers — pure(ish) async mappings.
 * Handlers receive (payload, context) and return Fact | Fact[] | void.
 * They NEVER append to EventLog directly — they return facts.
 * Engine appends returned facts after handler resolution.
 *
 * Streaming intermediate facts (message:created, tool_call:*)
 * are appended via eventLog during streaming — these are internal
 * session plumbing, not top-level handler results.
 *
 * Transient/streaming data uses the `broadcast` callback for
 * the ephemeral channel — never touches EventLog.
 */
import { buildPrompt } from './prompt-builder.js';
import { returnTool } from './lifecycle-tools.js';

const sessionStore = new Map();

export async function getCodingAgentModule() {
    return (await import('@oh-my-pi/resolve-pi')).getCodingAgentModule();
}

export const EffectHandlers = {};

function register(event) {
    return (fn) => {
        EffectHandlers[event] = fn;
    };
}

register('session:creating')(async (payload, { pi, getState, eventLog, broadcast }) => {
    const { nodeId, sessionId, phase, epoch = 0 } = payload;
    const state = getState();
    const { SessionManager } = await getCodingAgentModule();
    const options = buildSessionOptions(pi, phase);
    const sessionOpts = { ...options, sessionManager: SessionManager.create(options.cwd), customTools: [returnTool] };

    const { session } = await pi.pi.createAgentSession(sessionOpts);
    const actualSessionId = session.sessionFile;

    sessionStore.set(actualSessionId, { session, status: 'active' });
    if (actualSessionId !== sessionId) sessionStore.set(sessionId, sessionStore.get(actualSessionId));

    // Subscribe to session events for streaming — these append intermediate facts
    subscribeToSessionEvents(session, eventLog, sessionId, broadcast, getState);

    return {
        type: 'session:start',
        payload: {
            sessionId,
            nodeId,
            phase,
            epoch,
            model: options.model ? { provider: options.model.provider, id: options.model.id } : undefined,
        },
    };
});

register('session:prompting')(async (payload, { pi, getState, eventLog, broadcast }) => {
    const { sessionId, phase, nodeId, promptText } = payload;
    const entry = sessionStore.get(sessionId);
    if (!entry || entry.status !== 'active') return;

    // If Engine pre-built promptText, use it; otherwise fall back to building here
    let text = promptText;
    if (!text && !promptText) {
        const state = getState();
        const node = state.squad.nodes[nodeId];
        if (!node) return;
        text = buildPrompt(phase, state, node, eventLog);
    }

    if (text) {
        await entry.session.prompt(text);
    }
});

let _msgCounter = 0;

register('session:message')(async (payload, context) => {
    if (payload.role !== 'user') return;
    const { eventLog } = context;
    const messageId = payload.messageId || `usr_${++_msgCounter}`;
    return [
        { type: 'message:created', payload: { messageId, sessionId: payload.sessionId, role: 'user' } },
        { type: 'message:finalized', payload: { messageId, staticContent: extractText(payload.content) } },
    ];
});

register('squad:phase_changed')(async (payload, { eventLog, getState, pi }) => {
    if (payload.phase !== 'revising') return;
    const state = getState();
    const feedback = payload.feedback || 'No feedback provided';

    // Architect Awakening: inject the rejection feedback into the main session
    // so the agent can revise its plan and call delegate again.
    const mainSessionId = state.squad.mainSessionId;
    if (mainSessionId && state.sessions[mainSessionId]) {
        // Prompt the main session's LLM via pi.sendMessage (like ../squad handleSquad)
        // sendMessage is fire-and-forget (returns void per ExtensionAPI types)
        const msg = `[Squad-Tau Architect Awakening]\n\nYour outer review was rejected:\n\n${feedback}\n\nPlease analyze the feedback, revise your plan, and call \`squad_delegate\` again.`;

        // Return session:message fact for UI broadcast (Engine appends after handler resolution)
        return {
            type: 'session:message',
            payload: {
                sessionId: mainSessionId,
                role: 'user',
                content: [{ type: 'text', text: msg }],
            },
        };
    }
});

register('squad:force_replan_prompt')(async (payload, { pi }) => {
    if (!pi || typeof pi.sendMessage !== 'function') return;
    const feedback = payload.feedback || 'No feedback provided';
    const msg = `[Squad-Tau Architect Awakening — Re-prompt]\n\nYour outer review was rejected:\n\n${feedback}\n\nPlease analyze the feedback, revise your plan, and call \`squad_delegate\` again.`;
    pi.sendMessage(
        {
            customType: 'squad-revision-force',
            content: msg,
            display: false,
        },
        { triggerTurn: true },
    );
});

register('squad:complete')(() => {
    for (const entry of sessionStore.values()) {
        entry.session?.abort?.();
    }
    sessionStore.clear();
});

register('squad:abort')(() => {
    for (const entry of sessionStore.values()) {
        entry.session?.abort?.();
    }
    sessionStore.clear();
});

// ── Builder helpers ──

function buildSessionOptions(pi, phase) {
    const options = { cwd: process.cwd(), hasUI: false };
    const tl = pi?.getThinkingLevel?.();
    if (tl) options.thinkingLevel = tl;

    const isReviewer = phase === 'reviewing' || phase === 'outer_review';
    if (isReviewer) {
        // Reviewer sessions: read-only tools + return
        options.toolNames = ['read', 'search', 'find', 'lsp', 'bash', 'return'];
    } else {
        // Worker sessions: inherit parent tools (minus squad_delegate), ensure return
        const activeTools = pi?.getActiveTools?.()?.filter((t) => t !== 'squad_delegate') ?? [];
        if (activeTools.length > 0)
            options.toolNames = activeTools.includes('return') ? activeTools : [...activeTools, 'return'];
    }
    return options;
}

// ── Session event plumbing (LLM stream → domain facts) ──

const SessionEventHandlers = {
    message_update: handleMessageUpdate,
    tool_execution_start: handleToolStart,
    tool_execution_end: handleToolEnd,
    message_end: handleMessageEnd,
};

const seenMessages = new Map(); // sessionId → Set<messageId>

function subscribeToSessionEvents(session, eventLog, sessionId, broadcast, getState) {
    if (!seenMessages.has(sessionId)) seenMessages.set(sessionId, new Set());
    const ctx = { eventLog, sessionId, broadcast, getState };
    return session.subscribe((event) => {
        try {
            const handler = SessionEventHandlers[event.type];
            if (handler) handler(event, ctx);
        } catch {
            // non-fatal session event handler error
        }
    });
}

function handleMessageUpdate(event, { eventLog, sessionId, broadcast }) {
    const ae = event.assistantMessageEvent;
    if (!ae || !event.message || !event.message.id) return;

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
    if (broadcast) {
        broadcast('message:delta', {
            sessionId,
            messageId: event.message.id,
            delta: { type: deltaType, text: ae.delta },
        });
    }
}

function handleToolStart(event, { eventLog, sessionId }) {
    eventLog.append('tool_call:started', {
        toolId: event.toolCallId,
        sessionId,
        toolName: event.toolName,
        params: event.args,
    });
}

function handleToolEnd(event, { eventLog, sessionId, getState }) {
    eventLog.append('tool_call:finished', {
        toolId: event.toolCallId,
        result: event.result,
        isError: event.isError ?? false,
    });

    // Domain fact elevation: translate return tool into high-level domain facts
    if (event.toolName === 'return' && getState) {
        const state = getState();
        const session = state.sessions[sessionId];
        if (!session || !session.nodeId) return;
        const { nodeId, phase, epoch } = session;
        const node = state.squad.nodes[nodeId];
        if (!node) return;

        // Params were stored by tool_call:started projection
        const tc = state.toolCalls[event.toolCallId];
        if (!tc || tc.sessionId !== sessionId) return;
        const params = tc.params || {};

        if (phase === 'authoring' || phase === 'confirming') {
            eventLog.append('node:work_submitted', {
                nodeId,
                sessionId,
                summary: params.reason || '',
                affected_files: params.affected_files || [],
                epoch: epoch ?? node.epoch ?? 0,
            });
        } else if (phase === 'reviewing' || phase === 'outer_review') {
            eventLog.append('node:review_decided', {
                nodeId,
                sessionId,
                approved: params.status === 'ok',
                summary: params.reason || '',
                affected_files: params.affected_files || [],
                epoch: epoch ?? node.epoch ?? 0,
            });
        }

        // Session work is done — free the concurrency slot
        eventLog.append('session:end', { sessionId, reason: 'completed' });
    }
}

function handleMessageEnd(event, { eventLog, sessionId }) {
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

// ── Test-only exports ──
// These expose internal state/helpers for regression testing
// without polluting the production interface.

/** Expose handleToolEnd for engine-simulator to use real domain fact elevation */
export { handleToolEnd };

/** @returns {Map} sessionStore for test inspection */
export function _getSessionStore() {
    return sessionStore;
}

/** Set a test session entry in the store (avoids needing real OMP createAgentSession) */
export function _setTestSession(sessionId, entry) {
    sessionStore.set(sessionId, entry);
}

/** Clear the session store for test isolation */
export function _clearTestSession() {
    sessionStore.clear();
}

/** Expose buildSessionOptions for unit testing its filter logic */
export function _getWorkerSessionOptions(pi, phase) {
    return buildSessionOptions(pi, phase);
}
