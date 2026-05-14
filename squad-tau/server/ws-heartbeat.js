/**
 * WebSocket ping/pong heartbeat mechanism.
 * Pings every interval; terminates clients that miss two consecutive pongs (2×interval = timeout).
 * @see PRD/05-event-protocol.md §5.3
 * @see PRD/07-architecture.md §7.2.1
 */

import { getConnectionState } from './connection-state.js';

export const HEARTBEAT_INTERVAL = 30000;

const OPEN = 1;

/**
 * @param {Set<import('ws').WebSocket>} clients
 * @param {object} [opts]
 * @param {number} [opts.interval] - Ping interval in ms (default: DEFAULTS.HEARTBEAT_INTERVAL)
 * @returns {() => void} Cleanup function
 */
export function startHeartbeat(clients, opts = {}) {
    const interval = opts.interval || HEARTBEAT_INTERVAL;

    const ticker = setInterval(() => {
        for (const ws of clients) {
            if (ws.readyState !== OPEN) {
                ws.terminate();
                continue;
            }
            const state = getConnectionState(ws);
            state.missedPongs = (state.missedPongs ?? 0) + 1;
            if (state.missedPongs > 1) {
                ws.terminate();
                continue;
            }
            ws.ping();
        }
    }, interval);

    return () => clearInterval(ticker);
}
