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

export async function createWsServer(httpServer, _unused, { onConnection, onMessage } = {}) {
    const WebSocketServer = await getWsModule();
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws) => {
        ws.connId = nextConnId++;
        ws.isAlive = true;

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.send(
            JSON.stringify({
                type: 'connection:established',
                payload: { sessionId: ws.connId, serverVersion: '1.0.0' },
                timestamp: Date.now(),
            }),
        );
        onConnection?.(ws);

        ws.on('message', async (data) => {
            let parsed;
            try {
                parsed = JSON.parse(data);
            } catch {
                return;
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

    return { wss };
}
