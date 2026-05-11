import { requireScoped } from '@oh-my-pi/resolve-pi';

let WebSocketServer;

function getWs() {
    if (!WebSocketServer) {
        const require = requireScoped(import.meta.url);
        WebSocketServer = require('ws').WebSocketServer;
    }
    return WebSocketServer;
}

let nextConnId = 1;

export function createWsServer(httpServer, { onConnection, onMessage } = {}) {
    const wss = new (getWs())({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws) => {
        ws._connId = nextConnId++;

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
                const msg = JSON.parse(data);
                await onMessage?.(msg, ws);
            } catch (err) {
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        payload: { message: err.message },
                    }),
                );
            }
        });
    });

    return { wss };
}
