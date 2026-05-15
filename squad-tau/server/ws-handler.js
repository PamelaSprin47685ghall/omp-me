/**
 * WebSocket message routing.
 * EventLog-driven — no EventBus. Messages are appended to EventLog directly.
 * Frontend only sends: sync (catch-up), session:user_message, config:capacity_changed, ping, abort.
 * Backend only does: append to EventLog, let the reactor+engine drive everything.
 * Responses flow through fact channel (c:'f') or ephemeral channel (c:'e').
 *
 * No env:update escape hatch. Config changes are domain events (config:capacity_changed).
 */

const STRATEGIES = {
    sync: async ({ payload, eventLog, ws }) => {
        const { cursor } = payload || {};
        const missing = eventLog.getSince(cursor);
        for (const event of missing) {
            ws.send(
                JSON.stringify({
                    c: 'f',
                    event: event.event,
                    payload: event.payload,
                    timestamp: event.tick,
                    seq: event.id,
                }),
            );
        }
        return true;
    },
    'session:user_message': async ({ payload, eventLog }) => {
        const { sessionId, text, messageId } = payload || {};
        if (!sessionId || typeof text !== 'string') return true;

        eventLog.append('session:message', {
            sessionId,
            role: 'user',
            content: [{ type: 'text', text }],
            messageId: messageId || `usr_${eventLog.currentTick()}`,
        });
        return true;
    },
    'config:capacity_changed': async ({ payload, eventLog }) => {
        if (payload && typeof payload.maxWorkers === 'number') {
            eventLog.append('config:capacity_changed', { maxWorkers: payload.maxWorkers });
        }
        return true;
    },
    ping: async ({ ws, eventLog }) => {
        ws.send(JSON.stringify({ c: 'f', event: 'pong', timestamp: eventLog.currentTick() }));
        return true;
    },
    abort: async ({ payload, eventLog }) => {
        eventLog.append('squad:abort', payload || {});
        return true;
    },
};

export async function routeMessage(msg, eventLog, ws, getState) {
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
            ws.send(JSON.stringify({ c: 'f', event: 'error', payload: { message: err.message } }));
            return true;
        }
    }
    return false;
}
