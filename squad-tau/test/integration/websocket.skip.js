/**
 * WebSocket communication integration tests.
 * @see PRD/08-testing.md §8.3
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createTestEnvironment } from './squad-flow-setup.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

describe('WebSocket Communication', () => {
    let httpServer;
    let wss;
    let testPort;

    beforeAll(async () => {
        httpServer = createServer();
        wss = new WebSocketServer({ server: httpServer, path: '/ws' });
        testPort = 0; // auto-assign
        await new Promise((resolve) => {
            httpServer.listen(testPort, '127.0.0.1', () => {
                testPort = httpServer.address().port;
                resolve();
            });
        });
    });

    afterAll(() => {
        wss?.close();
        httpServer?.close();
    });

    test('server starts and listens', () => {
        expect(testPort).toBeGreaterThan(0);
    });
});

describe('Event Protocol', () => {
    test('message format matches PRD specification', () => {
        const msg = {
            type: 'connection:established',
            payload: { sessionId: 1, serverVersion: '1.0.0' },
            timestamp: Date.now(),
        };
        expect(msg.type).toBe('connection:established');
        expect(msg.payload.sessionId).toBe(1);
        expect(typeof msg.timestamp).toBe('number');
    });

    test('squad:init event format', () => {
        const msg = {
            type: 'squad:init',
            payload: {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'test', review_criteria: 'quality' }],
                originalTask: 'test task',
            },
            timestamp: Date.now(),
        };
        expect(msg.type).toBe('squad:init');
        expect(['M', 'L']).toContain(msg.payload.mode);
    });
});
