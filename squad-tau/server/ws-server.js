import { WebSocketServer, WebSocket } from 'ws';

let nextConnId = 1;

export function createWsServer(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws) => {
        ws._connId = nextConnId++;

        ws.send(
            JSON.stringify({
                type: 'connection:established',
                payload: { sessionId: ws._connId, serverVersion: '1.0.0' },
                timestamp: Date.now(),
            }),
        );
    });

    return { wss };
}
