export const HEARTBEAT_INTERVAL = 30000;

const OPEN = 1;

export function startHeartbeat(clients, opts = {}) {
    const interval = opts.interval || HEARTBEAT_INTERVAL;

    const ticker = setInterval(() => {
        for (const ws of clients) {
            if (ws.readyState !== OPEN) {
                ws.terminate();
                continue;
            }
            if (!ws.isAlive) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, interval);

    return () => clearInterval(ticker);
}
