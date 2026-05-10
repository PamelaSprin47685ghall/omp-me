/**
 * WebSocket message routing by type.
 * @see PRD/05-event-protocol.md §5.3/5.7
 * @see PRD/07-architecture.md §7.2.1
 */

import { handleModelPoolMessage } from './model-pool-events.js';
import * as sessionRegistry from './session-registry.js';

/**
 * Routes incoming WebSocket messages by type.
 * @param {object} msg - Parsed WebSocket message
 * @param {import('./model-pool.js').ModelPool} modelPool
 * @param {object} configModule - model-pool-config module
 * @param {import('./event-bus.js').EventBus} eventBus
 * @param {import('ws').WebSocket} ws - Sender WebSocket
 * @returns {Promise<boolean>} true if handled, false for unknown types
 */
export async function routeMessage(msg, modelPool, configModule, eventBus, ws) {
    if (!msg || typeof msg.type !== 'string') return false;

    switch (msg.type) {
        case 'model_pool:update':
            await handleModelPoolMessage(msg.payload, modelPool, configModule, eventBus);
            return true;

        case 'session:user_message': {
            const { sessionId, text } = msg.payload || {};
            if (!sessionId || typeof text !== 'string') {
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        payload: { message: 'Invalid session:user_message payload' },
                        timestamp: Date.now(),
                    }),
                );
                return true;
            }

            const entry = sessionRegistry.get(sessionId);
            if (!entry || !sessionRegistry.isActive(sessionId)) {
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        payload: { message: 'Session not active' },
                        timestamp: Date.now(),
                    }),
                );
                return true;
            }

            // Broadcast user message to all connected clients (multi-tab sync)
            eventBus.emit('session', 'message', {
                sessionId,
                role: 'user',
                content: [{ type: 'text', text }],
                messageId: `user-${Date.now()}`,
                timestamp: Date.now(),
            });

            await entry.sendUserMessage(text);
            return true;
        }

        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return true;

        case 'abort':
            eventBus.emit('squad', 'abort', msg.payload || {});
            return true;

        default:
            return false;
    }
}
