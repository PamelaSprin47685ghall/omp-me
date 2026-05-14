/**
 * WebSocket message routing.
 * EventLog-driven — no EventBus. Messages are appended to EventLog directly.
 * Frontend only sends: sync (catch-up), session:user_message, model_pool:update, ping, abort.
 * Backend only does: append to EventLog, let the reactor+engine drive everything.
 *
 * User messages are NOT sent to LLM directly — they are appended as
 * session:user_message_received facts and processed by the Engine pulse.
 */
import { handleModelPoolMessage } from './model-pool.js';

const STRATEGIES = {
    sync: async ({ payload, eventLog, ws }) => {
        const { cursor } = payload || {};
        const missing = eventLog.getSince(cursor);
        for (const event of missing) {
            ws.send(
                JSON.stringify({
                    type: event.event,
                    payload: event.payload,
                    timestamp: event.timestamp,
                    seq: event.id,
                }),
            );
        }
        return true;
    },
    'model_pool:update': async ({ payload, eventLog, ws }) => {
        await handleModelPoolMessage(payload, eventLog, ws?.getState);
        return true;
    },
    'session:user_message': async ({ payload, eventLog }) => {
        const { sessionId, text, messageId } = payload || {};
        if (!sessionId || typeof text !== 'string') return true;

        // Append user message to EventLog for state tracking
        eventLog.append('session:message', {
            sessionId,
            role: 'user',
            content: [{ type: 'text', text }],
            messageId: messageId || `usr_${Date.now()}`,
        });

        // Append trigger fact for the Engine pulse to route to LLM
        eventLog.append('session:user_message_received', {
            sessionId,
            text,
            messageId: messageId || `usr_${Date.now()}`,
        });
        return true;
    },
    ping: async ({ ws }) => {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return true;
    },
    abort: async ({ payload, eventLog }) => {
        eventLog.append('squad:abort', payload || {});
        return true;
    },
};

export async function routeMessage(msg, eventLog, ws, getState) {
    // Attach getState to ws object for downstream handlers
    if (!ws.getState && getState) ws.getState = getState;
    if (!msg || typeof msg.type !== 'string') return false;
    const strategy = STRATEGIES[msg.type];
    if (strategy) {
        try {
            return await strategy({
                payload: msg.payload,
                eventLog,
                ws,
            });
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: err.message } }));
            return true;
        }
    }
    return false;
}
