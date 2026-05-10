import { describe, test, expect, beforeEach } from 'bun:test';
import { EventBus } from '../../server/event-bus.js';

function createMockClients() {
    const clients = new Set();
    function addWs() {
        const messages = [];
        const ws = {
            readyState: 1, // WebSocket.OPEN
            send: (data) => messages.push(data),
            close: () => {
                ws.readyState = 3;
            },
        };
        clients.add(ws);
        return { ws, messages };
    }
    return { clients, addWs };
}

// Manually test the bridge logic without importing (which needs ws module)
function bridgeEventsToWebSocket(eventBus, clients) {
    const unsub = eventBus.on('*', (payload, type) => {
        const message = JSON.stringify({ type, payload, timestamp: Date.now() });
        for (const ws of clients) {
            if (ws.readyState === 1) {
                ws.send(message);
            }
        }
    });
    return unsub;
}

describe('bridgeEventsToWebSocket', () => {
    let eventBus;
    let clients, addWs;

    beforeEach(() => {
        eventBus = new EventBus();
        clients = createMockClients();
        addWs = clients.addWs;
    });

    test('forwards squad:* events to all connected clients', () => {
        bridgeEventsToWebSocket(eventBus, clients.clients);
        const { ws, messages } = addWs();

        eventBus.emit('squad', 'init', { mode: 'M', nodes: [] });

        expect(messages.length).toBe(1);
        const msg = JSON.parse(messages[0]);
        expect(msg.type).toBe('squad:init');
        expect(msg.payload.mode).toBe('M');
        expect(typeof msg.timestamp).toBe('number');
    });

    test('forwards session:* events to all connected clients', () => {
        bridgeEventsToWebSocket(eventBus, clients.clients);
        const { ws, messages } = addWs();

        eventBus.emit('session', 'message', { sessionId: 's1', role: 'user', content: [] });

        expect(messages.length).toBe(1);
        const msg = JSON.parse(messages[0]);
        expect(msg.type).toBe('session:message');
        expect(msg.payload.sessionId).toBe('s1');
    });

    test('forwards model_pool:* events to all connected clients', () => {
        bridgeEventsToWebSocket(eventBus, clients.clients);
        const { ws, messages } = addWs();

        eventBus.emit('model_pool', 'changed', { slots: [] });

        expect(messages.length).toBe(1);
        const msg = JSON.parse(messages[0]);
        expect(msg.type).toBe('model_pool:changed');
    });

    test('sends messages to multiple clients', () => {
        bridgeEventsToWebSocket(eventBus, clients.clients);
        const { messages: m1 } = addWs();
        const { messages: m2 } = addWs();

        eventBus.emit('squad', 'node_state', { nodeId: 'n1' });

        expect(m1.length).toBe(1);
        expect(m2.length).toBe(1);
    });

    test('skips non-OPEN clients', () => {
        bridgeEventsToWebSocket(eventBus, clients.clients);
        const { ws: ws1, messages: m1 } = addWs();
        ws1.readyState = 3; // CLOSED

        const { messages: m2 } = addWs();

        eventBus.emit('squad', 'init', {});

        expect(m1.length).toBe(0);
        expect(m2.length).toBe(1);
    });

    test('returns unsubscribe function that stops forwarding', () => {
        const unsub = bridgeEventsToWebSocket(eventBus, clients.clients);
        const { messages } = addWs();

        unsub();
        eventBus.emit('squad', 'init', {});

        expect(messages.length).toBe(0);
    });
});
