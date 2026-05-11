/**
 * EventBus to WebSocket broadcast bridge.
 * @see PRD/05-event-protocol.md §5.2
 * @see PRD/07-architecture.md §7.2.2
 */

import { requireScoped } from '@oh-my-pi/resolve-pi';

let WsClass;

function getWs() {
    if (!WsClass) {
        const require = requireScoped(import.meta.url);
        WsClass = require('ws').WebSocket;
    }
    return WsClass;
}

/**
 * Subscribes to all eventBus events and broadcasts to WebSocket clients.
 * @param {import('./event-bus.js').EventBus} eventBus
 * @param {Set<import('ws').WebSocket>} clients - Set of connected WebSocket clients
 */
export function bridgeEventsToWebSocket(eventBus, clients) {
    const WebSocket = getWs();

    eventBus.on('*', (payload, type) => {
        const message = JSON.stringify({
            type,
            payload,
            timestamp: Date.now(),
        });

        for (const ws of clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    });
}
