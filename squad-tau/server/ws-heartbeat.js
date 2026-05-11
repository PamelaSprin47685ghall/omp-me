/**
 * WebSocket ping/pong heartbeat mechanism.
 * @see PRD/05-event-protocol.md §5.3
 * @see PRD/07-architecture.md §7.2.1
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

const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 60000;

/**
 * Starts heartbeat for all connected clients.
 * Pings every 30s, removes clients that don't pong within 60s.
 * @param {Set<import('ws').WebSocket>} clients - Set of connected WebSocket clients
 * @returns {() => void} Cleanup function to clear interval
 */
export function startHeartbeat(clients) {
    const WebSocket = getWs();

    const interval = setInterval(() => {
        const now = Date.now();
        for (const ws of clients) {
            if (ws.readyState !== WebSocket.OPEN) {
                clients.delete(ws);
                continue;
            }

            if (ws.isAlive === false) {
                ws.terminate();
                clients.delete(ws);
                continue;
            }

            if (ws.lastPing && now - ws.lastPing > PONG_TIMEOUT) {
                ws.terminate();
                clients.delete(ws);
                continue;
            }

            ws.isAlive = false;
            ws.lastPing = now;
            ws.ping();
        }
    }, PING_INTERVAL);

    return () => clearInterval(interval);
}

/**
 * Marks client as alive on pong.
 * @param {import('ws').WebSocket} ws
 */
export function handlePong(ws) {
    ws.isAlive = true;
}
