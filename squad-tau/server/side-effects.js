/**
 * Stateless SideEffects Router — EventLog subscriber, fire-and-forget.
 *
 * Holds ZERO business state. Maps fact types to async handlers.
 * Handlers never read business state — they receive the payload and
 * a dispatch callback to emit new facts back to the EventLog.
 *
 * No useEffect, no session pools, no memoisation — pure IO.
 *
 * ── Test infrastructure ──
 *
 * _sessionStore is a test-only Map used to inject mock OMP sessions
 * into EffectHandlers. Production sessions live in the OMP runtime
 * and are never stored here. This keeps the side-effect layer
 * deterministic and fully assertable without a real LLM.
 *
 * EffectHandlers map event types to async (payload, deps) ⇒ void | fact.
 * Each handler is a pure function of its inputs — no state, no history scan.
 * When a handler returns a fact object ({ type, payload }), the caller
 * (PulseEngine or test harness) appends it to the EventLog.
 */

// ── Test session store (Map, not WeakMap — assertions iterate entries) ──
const _sessionStore = new Map();

export function _setTestSession(id, entry) {
    _sessionStore.set(id, entry);
}

export function _clearTestSession() {
    _sessionStore.clear();
}

export function _getSessionStore() {
    return _sessionStore;
}

/**
 * Build session options for a worker session based on phase.
 *
 * Workers (authoring/confirming): full tool set minus squad_delegate and return
 *   (return is injected via customTools by the engine, not from toolNames).
 * Reviewers (reviewing/outer_review): restricted to read-only + language tools.
 *
 * Carries forward thinkingLevel from the parent session via pi.getThinkingLevel().
 *
 * @param {object} pi — PluginInstance with getActiveTools() and getThinkingLevel()
 * @param {string} phase — 'authoring' | 'confirming' | 'reviewing' | 'outer_review'
 * @returns {{ toolNames: string[], thinkingLevel: string|undefined }}
 */
export function _getWorkerSessionOptions(pi, phase) {
    const toolNames = pi.getActiveTools?.() ?? [];
    const thinkingLevel = pi.getThinkingLevel?.() ?? undefined;

    if (phase === 'reviewing' || phase === 'outer_review') {
        // Reviewers: read-only + search + language tools
        return { toolNames: ['read', 'search', 'find', 'lsp', 'bash'], thinkingLevel };
    }

    // Workers (authoring, confirming): full tools minus squad_delegate and return
    const filtered = toolNames.filter((t) => t !== 'squad_delegate' && t !== 'return');
    return { toolNames: filtered, thinkingLevel };
}

/**
 * Handle tool call completion with O(1) state access.
 *
 * Always appends tool_call:finished to the EventLog.
 * For return tools, additionally promotes domain facts:
 *   - node:work_submitted — signals the engine to advance the node phase
 *   - session:end — marks the worker session as complete
 *
 * @param {{ toolCallId: string, toolName: string, result: object, isError: boolean }} callResult
 * @param {{ eventLog: EventLog, sessionId: string, getState: () => object }} deps
 */
export async function handleToolEnd(callResult, { eventLog, sessionId, getState }) {
    const { toolCallId, toolName, result, isError } = callResult;

    // Always record the tool call completion (O(1) append)
    eventLog.append('tool_call:finished', {
        toolId: toolCallId,
        toolName,
        result,
        isError,
    });

    if (toolName !== 'return') return;

    const state = getState();
    const toolCall = state.toolCalls?.[toolCallId];
    if (!toolCall) return;

    // Validate session ownership (O(1) hash access — no .find/.filter)
    if (toolCall.sessionId !== sessionId) return;

    const sessionState = state.sessions?.[sessionId];
    if (!sessionState) return;

    const nodeId = sessionState.nodeId;
    if (!nodeId) return;

    // Promote domain facts for return tool completion
    eventLog.append('node:work_submitted', {
        nodeId,
        toolCallId,
        result,
        sessionId,
    });

    eventLog.append('session:end', {
        sessionId,
        reason: 'work_submitted',
    });
}

/**
 * EffectHandlers — stateless async handler map.
 *
 * Each handler receives (payload, deps) where deps may contain:
 *   broadcast   — ephemeral event broadcaster
 *   getState    — () => State tree
 *   eventLog    — EventLog reference
 *   pi          — PluginInstance
 *
 * Handlers NEVER hold state, NEVER scan event history.
 * Handlers return undefined (fire-and-forget) or a fact object
 * ({ type, payload }) that the caller appends to the EventLog.
 */
export const EffectHandlers = {
    /**
     * session:prompting — await the OMP session.prompt() call.
     * Looks up the session in _sessionStore (test DI), calls prompt(),
     * and blocks until the LLM responds.
     */
    'session:prompting': async (payload, deps) => {
        const { sessionId, promptText } = payload;
        const entry = _sessionStore.get(sessionId);
        if (!entry || entry.status !== 'active') return;
        await entry.session.prompt(promptText);
    },

    /**
     * squad:abort — abort all active test sessions and clear the store.
     */
    'squad:abort': async (payload, deps) => {
        for (const [id, entry] of _sessionStore) {
            if (typeof entry.session?.abort === 'function') {
                entry.session.abort();
            }
        }
        _sessionStore.clear();
    },

    /**
     * squad:complete — same as abort: abort all active sessions and clear.
     */
    'squad:complete': async (payload, deps) => {
        for (const [id, entry] of _sessionStore) {
            if (typeof entry.session?.abort === 'function') {
                entry.session.abort();
            }
        }
        _sessionStore.clear();
    },

    /**
     * squad:phase_changed — architect awakening.
     * When phase transitions to 'revising', returns a session:message fact
     * containing the outer-review feedback for the main session.
     */
    'squad:phase_changed': async (payload, deps) => {
        const { phase, feedback } = payload;
        if (phase !== 'revising') return;
        const state = deps.getState?.();
        if (!state) return;
        const mainSessionId = state.squad?.mainSessionId;
        if (!mainSessionId) return;
        return {
            type: 'session:message',
            payload: {
                sessionId: mainSessionId,
                role: 'user',
                content: [{ type: 'text', text: `Architect Awakening: ${feedback}` }],
            },
        };
    },

    /**
     * squad:force_replan_prompt — send replan prompt to main session.
     */
    'squad:force_replan_prompt': async (payload, deps) => {
        const state = deps.getState?.();
        if (!state) return;
        const mainSessionId = state.squad?.mainSessionId;
        if (!mainSessionId) return;
        return {
            type: 'session:message',
            payload: {
                sessionId: mainSessionId,
                role: 'user',
                content: [{ type: 'text', text: payload.feedback || 'Please revise the plan.' }],
            },
        };
    },
};

export class SideEffectsRouter {
    constructor() {
        this._handlers = Object.create(null);
    }

    on(eventType, fn) {
        this._handlers[eventType] = fn;
    }

    dispatch(eventType, payload) {
        const fn = this._handlers[eventType];
        if (!fn) return;
        // Fire-and-forget: result flows back via the dispatch callback
        fn(payload, this._append);
    }

    setAppend(fn) {
        this._append = fn;
    }
}
