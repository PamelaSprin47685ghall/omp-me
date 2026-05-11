/**
 * WebSocket ping/pong heartbeat mechanism.
 * Uses numeric readyState (1 = OPEN) to avoid lazy ws import dependency.
 * @see PRD/05-event-protocol.md §5.3
 * @see PRD/07-architecture.md §7.2.1
 */

const PING_INTERVAL = 30000;
const OPEN = 1;

/**
 * Starts heartbeat for all connected clients.
 * Pings every 30s, terminates clients that don't pong.
 * @param {Set<import('ws').WebSocket>} clients - Set of connected WebSocket clients
 * @returns {() => void} Cleanup function to clear interval
 */
export function startHeartbeat(clients) {
    const interval = setInterval(() => {
        for (const ws of clients) {
            if (ws.readyState !== OPEN) {
                ws.terminate();
                continue;
            }
            if (ws.isAlive === false) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, PING_INTERVAL);
    return () => clearInterval(interval);
}
