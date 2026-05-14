/**
 * The Squad-Tau Engine (v2 — High-Water Mark + Direct Action Routing).
 *
 * Event-driven pulse: fact appended → incrementally fold into State →
 * debounced microtask → react(state) → Action[] → execute inline.
 *
 * Key differences from v1:
 *   - No while-loop: single react() pass per pulse; cascading handled by
 *     dirty→microtask→pulse recursion
 *   - No running flag: microtasks debounced via dirty flag
 *   - CMD_ events are NOT appended to EventLog (they are intents, not facts).
 *     Instead, they are executed directly with transitional facts appended
 *     to prevent reactor re-emission.
 *   - Side-effect handlers imported from side-effects.js (no duplication).
 *   - User messages routed via EventLog through the pulse.
 */
import { reactState } from './reactor.js';
import { handleCreateSession, handlePrompt, handleUserMessage, sessionStore } from './side-effects.js';
import { applyEvent, getInitialState } from '../shared/projections.js';
import { Events } from '../shared/events.js';

export function setupEngine(eventLog, pi) {
    let state = getInitialState();
    let dirty = false;
    let lastUserMsgSeq = -1;

    // Incremental fold: update state as events arrive
    const unsubLog = eventLog.subscribe((entry) => {
        applyEvent(state, entry.event, entry.payload);
    });

    // Debounced pulse: microtask batch
    const unsubPulse = eventLog.subscribe(() => {
        if (!dirty) {
            dirty = true;
            queueMicrotask(() => {
                dirty = false;
                pulse();
            });
        }
    });

    // Closure for side-effect handlers to read engine's incremental state
    const getState = () => state;

    function pulse() {
        const actions = reactState(state);

        // Detect pending user messages via watermark — no full log scan
        const recentEntries = eventLog.getSince(lastUserMsgSeq < 0 ? 0 : lastUserMsgSeq + 1);
        for (const entry of recentEntries) {
            if (entry.event === 'session:user_message_received') {
                actions.push({
                    type: 'cmd:user_message',
                    payload: entry.payload,
                });
            }
            if (entry.id > lastUserMsgSeq) lastUserMsgSeq = entry.id;
        }

        if (actions.length === 0) return;

        for (const action of actions) {
            if (action.type.startsWith('cmd:')) {
                appendTransition(action);
                runAction(action);
            } else {
                // State-transition fact (SQUAD_NODE_STATE, MODEL_POOL_ACQUIRE, etc.)
                eventLog.append(action.type, action.payload);
            }
        }
    }

    function appendTransition(action) {
        switch (action.type) {
            case Events.CMD_CREATE_SESSION:
                eventLog.append(Events.SESSION_CREATING, {
                    nodeId: action.payload.nodeId,
                    phase: action.payload.phase,
                });
                break;
            case Events.CMD_PROMPT:
                eventLog.append(Events.SESSION_PROMPTING, {
                    sessionId: action.payload.sessionId,
                    phase: action.payload.phase,
                });
                break;
        }
    }

    function runAction(action) {
        switch (action.type) {
            case Events.CMD_CREATE_SESSION:
                handleCreateSession(action.payload, eventLog, pi, getState).catch((err) => {
                    console.error(`[Engine] createSession failed:`, err);
                    const node = state.squad.nodes.find((n) => n.id === action.payload.nodeId);
                    if (node) node.sessionStatus = 'none';
                });
                break;
            case Events.CMD_PROMPT:
                handlePrompt(action.payload, eventLog, pi, getState).catch((err) =>
                    console.error(`[Engine] sendPrompt failed:`, err),
                );
                break;
            case 'cmd:user_message':
                handleUserMessage(action.payload).catch((err) => console.error(`[Engine] userMessage failed:`, err));
                break;
        }
    }

    return {
        cleanup: () => {
            unsubLog();
            unsubPulse();
        },
        getState: () => state,
    };
}
