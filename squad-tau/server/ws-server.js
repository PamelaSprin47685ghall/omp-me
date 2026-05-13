/**
 * WebSocket server — single owner of ws lifecycle and broadcast.
 * Subscribes directly to the event bus; no cross-module client Set passing.
 */

let nextConnId = 1;
let wsModulePromise = null;

async function getWsModule() {
    if (!wsModulePromise) {
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
        ws._missedPongs = 0;
        ws.on('pong', () => {
            ws._missedPongs = 0;
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
            let parsed;
            try {
                parsed = JSON.parse(data);
            } catch {
                return; // drop malformed
            }
            try {
                await onMessage?.(parsed, ws);
            } catch (err) {
                try {
                    ws.send(JSON.stringify({ type: 'error', payload: { message: err.message } }));
                } catch {}
            }
        });
    });

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
