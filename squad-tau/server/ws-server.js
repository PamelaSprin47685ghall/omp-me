export const HEARTBEAT_INTERVAL = 30000;

const WS_OPEN = 1;
let nextConnId = 1;
let wsModulePromise = null;

export function startHeartbeat(clients, opts = {}) {
    const interval = opts.interval || HEARTBEAT_INTERVAL;
    const ticker = setInterval(() => {
        for (const ws of clients) {
            if (ws.readyState !== WS_OPEN) {
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
                timestamp: 0,
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
