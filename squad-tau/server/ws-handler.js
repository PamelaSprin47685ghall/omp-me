/**
 * WebSocket message routing by type.
 * @see PRD/05-event-protocol.md §5.3/5.7
 * @see PRD/07-architecture.md §7.2.1
 */

import { handleModelPoolMessage } from './model-pool-events.js';
import * as sessionRegistry from './session-registry.js';

function wsSendError(ws, message) {
    ws.send(JSON.stringify({ type: 'error', payload: { message }, timestamp: Date.now() }));
}

function genMessageId() {
    return `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function handleUserMessage(payload, eventBus, ws) {
    const { sessionId, text } = payload || {};
    if (!sessionId || typeof text !== 'string') {
        wsSendError(ws, 'Invalid session:user_message payload');
        return true;
    }
    const entry = sessionRegistry.get(sessionId);
    if (!entry || !sessionRegistry.isActive(sessionId)) {
        wsSendError(ws, 'Session not active');
        return true;
    }
    eventBus.emit('session', 'message', {
        sessionId,
        role: 'user',
        content: [{ type: 'text', text }],
        messageId: genMessageId(),
    });
    await entry.sendUserMessage(text);
    return true;
}

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
        case 'session:user_message':
            return handleUserMessage(msg.payload, eventBus, ws);
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
