/**
 * WebSocket communication integration tests.
 * @see PRD/08-testing.md §8.3
 * @see PRD/05-event-protocol.md
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { startServer, stopServer, getGlobalEventBus, getGlobalModelPool } from '../../server/server-lifecycle.js';
import * as sessionRegistry from '../../server/session-registry.js';
import { WebSocket } from 'ws';

describe('WebSocket Integration', () => {
    let port;

    beforeEach(async () => {
        process.env.SKIP_VITE = 'true';
        const result = await startServer();
        port = result.port;
    });

    afterEach(async () => {
        await stopServer();
        delete process.env.SKIP_VITE;
    });

    const getUrl = () => `ws://127.0.0.1:${port}/ws`;

    test('connection:established and model_pool:snapshot are received', async () => {
        const ws = new WebSocket(getUrl());
        const messages = [];

        await new Promise((resolve, reject) => {
            ws.on('message', (data) => {
                const msg = JSON.parse(data);
                messages.push(msg);
                if (messages.length >= 2) resolve();
            });
            ws.on('error', reject);
            setTimeout(() => reject(new Error('Timeout waiting for initial messages')), 2000);
        });

        expect(messages[0].type).toBe('connection:established');
        expect(messages[0].payload).toHaveProperty('sessionId');

        expect(messages[1].type).toBe('model_pool:snapshot');
        expect(messages[1]).toHaveProperty('timestamp');
        expect(typeof messages[1].timestamp).toBe('number');

        ws.close();
    });

    test('ping-pong routing', async () => {
        const ws = new WebSocket(getUrl());
        await new Promise((r) => ws.on('open', r));

        ws.send(JSON.stringify({ type: 'ping' }));

        const pong = await new Promise((resolve, reject) => {
            ws.on('message', (data) => {
                const msg = JSON.parse(data);
                if (msg.type === 'pong') resolve(msg);
            });
            setTimeout(() => reject(new Error('Timeout waiting for pong')), 2000);
        });

        expect(pong.type).toBe('pong');
        expect(pong.timestamp).toBeDefined();
        ws.close();
    });

    test('broadcast (multi-client sync)', async () => {
        const ws1 = new WebSocket(getUrl());
        const ws2 = new WebSocket(getUrl());

        await Promise.all([new Promise((r) => ws1.on('open', r)), new Promise((r) => ws2.on('open', r))]);

        const ws2Messages = [];
        const msgReceived = new Promise((resolve) => {
            ws2.on('message', (data) => {
                const msg = JSON.parse(data);
                if (msg.type === 'custom:event') {
                    ws2Messages.push(msg);
                    resolve();
                }
            });
        });

        const eventBus = getGlobalEventBus();
        eventBus.emit('custom', 'event', { data: 'broadcast-test' });

        await msgReceived;

        expect(ws2Messages.length).toBe(1);
        expect(ws2Messages[0].payload.data).toBe('broadcast-test');
        expect(ws2Messages[0].type).toBe('custom:event');

        ws1.close();
        ws2.close();
    });

    test('session:user_message routing and broadcast', async () => {
        const sessionId = 'test-session-' + Date.now();
        const userText = 'Hello from integration test';

        let sessionReceivedText = null;
        const mockSession = {
            status: 'running',
            sendUserMessage: async (text) => {
                sessionReceivedText = text;
            },
        };
        sessionRegistry.register(sessionId, mockSession);

        const ws = new WebSocket(getUrl());
        await new Promise((r) => ws.on('open', r));

        const broadcastedMsgs = [];
        const broadcastReceived = new Promise((resolve) => {
            ws.on('message', (data) => {
                const msg = JSON.parse(data);
                if (msg.type === 'session:message') {
                    broadcastedMsgs.push(msg);
                    resolve();
                }
            });
        });

        ws.send(
            JSON.stringify({
                type: 'session:user_message',
                payload: { sessionId, text: userText },
            }),
        );

        await broadcastReceived;

        expect(sessionReceivedText).toBe(userText);
        expect(broadcastedMsgs.length).toBe(1);
        expect(broadcastedMsgs[0].payload.sessionId).toBe(sessionId);
        expect(broadcastedMsgs[0].payload.content[0].text).toBe(userText);
        expect(broadcastedMsgs[0].payload.role).toBe('user');

        ws.close();
        sessionRegistry.unregister(sessionId);
    });

    test('message format has type, payload, timestamp', async () => {
        const ws = new WebSocket(getUrl());
        await new Promise((r) => ws.on('open', r));

        const msg = await new Promise((resolve) => {
            ws.on('message', (data) => {
                const parsed = JSON.parse(data);
                if (parsed.type === 'model_pool:snapshot') resolve(parsed);
            });
        });

        expect(msg).toHaveProperty('type');
        expect(msg).toHaveProperty('payload');
        expect(msg).toHaveProperty('timestamp');
        expect(typeof msg.type).toBe('string');
        expect(typeof msg.timestamp).toBe('number');

        ws.close();
    });
});
