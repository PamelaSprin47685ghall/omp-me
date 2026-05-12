/**
 * WebSocket ping/pong heartbeat mechanism.
 * Uses numeric readyState (1 = OPEN) to avoid lazy ws import dependency.
 * @see PRD/05-event-protocol.md §5.3
 * @see PRD/07-architecture.md §7.2.1
 */

import { DEFAULTS } from './constants.js';

const OPEN = 1;

/**
 * Starts heartbeat for all connected clients.
 * Pings every HEARTBEAT_INTERVAL ms, terminates clients that don't pong
 * within HEARTBEAT_TIMEOUT ms.
 * @param {Set<import('ws').WebSocket>} clients - Set of connected WebSocket clients
 * @param {object} [opts]
 * @param {number} [opts.interval] - Ping interval in ms (default: DEFAULTS.HEARTBEAT_INTERVAL)
 * @param {number} [opts.timeout] - Pong timeout in ms (default: DEFAULTS.HEARTBEAT_TIMEOUT)
 * @returns {() => void} Cleanup function to clear interval
 */
export function startHeartbeat(clients, opts = {}) {
    const interval = opts.interval || DEFAULTS.HEARTBEAT_INTERVAL;
    const timeout = opts.timeout || DEFAULTS.HEARTBEAT_TIMEOUT;

    const pingTimer = setInterval(() => {
        const now = Date.now();
        for (const ws of clients) {
            if (ws.readyState !== OPEN) {
                ws.terminate();
                continue;
            }
            if (ws.isAlive === false) {
                // No pong received since last ping — exceed timeout
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, interval);

    // Secondary timer to terminate clients that missed deadline
    const timeoutTimer = setInterval(() => {
        const deadline = Date.now() - timeout - interval;
        for (const ws of clients) {
            if (ws.readyState !== OPEN) continue;
            if (ws._lastPong && ws._lastPong < deadline) {
                ws.terminate();
            }
        }
    }, timeout);

    return () => {
        clearInterval(pingTimer);
        clearInterval(timeoutTimer);
    };
}
