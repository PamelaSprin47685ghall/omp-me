import { WebSocketServer, WebSocket } from 'ws';

export function createWsServer(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    function broadcast(data) {
        const message = JSON.stringify(data);
        const deadClients = [];

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (err) {
                    deadClients.push(client);
                }
            } else if (client.readyState === WebSocket.CLOSED) {
                deadClients.push(client);
            }
        });

        deadClients.forEach((client) => {
            try {
                client.terminate();
            } catch {}
        });
    }

    function getClientCount() {
        let count = 0;
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                count++;
            }
        });
        return count;
    }

    return { wss, broadcast, getClientCount };
}
