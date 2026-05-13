/**
 * WebSocket server — single owner of ws lifecycle and broadcast.
 * Subscribes directly to the event bus; no cross-module client Set passing.
 */

let nextConnId = 1;
let wsModulePromise = null;

async function getWsModule() {
    if (!wsModulePromise) {
        // Use importNodeModule to bypass OMP's bare-import rewriting and resolve from root node_modules.
        wsModulePromise = import('@oh-my-pi/resolve-pi').then((mod) =>
            mod.importNodeModule('ws').then((m) => m.WebSocketServer),
        );
    }
    return wsModulePromise;
}

export async function createWsServer(httpServer, eventBus, { onConnection, onMessage } = {}) {
    const WebSocketServer = await getWsModule();
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws) => {
        ws._connId = nextConnId++;

        // Enable heartbeat ping-pong
        ws.isAlive = true;
        ws._lastPong = Date.now();
        ws.on('pong', () => {
            ws.isAlive = true;
            ws._lastPong = Date.now();
        });

        ws.send(
            JSON.stringify({
                type: 'connection:established',
                payload: { sessionId: ws._connId, serverVersion: '1.0.0' },
                timestamp: Date.now(),
            }),
        );
        onConnection?.(ws);

        ws.on('message', async (data) => {
            try {
                await onMessage?.(JSON.parse(data), ws);
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', payload: { message: err.message } }));
            }
        });
    });

    // Broadcast all eventBus events to every connected client
    let unsub = () => {};
    if (eventBus) {
        unsub = eventBus.on('*', (payload, type) => {
            const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
            for (const ws of wss.clients) {
                try {
                    if (ws.readyState === 1) ws.send(msg);
                } catch {
                    /* skip dead */
                }
            }
        });
    }

    return { wss, unsub };
}
