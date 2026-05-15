import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

// ── Regression: server must start and return port (REPAIR.md §1) ──
describe('server lifecycle regression', () => {
    let server, port;

    beforeAll(async () => {
        const { startServer, stopServer } = await import('../../server/server-lifecycle.js');
        server = await startServer({ skipVite: true });
        port = server.port;
    }, 15000);

    afterAll(async () => {
        const { stopServer } = await import('../../server/server-lifecycle.js');
        await stopServer();
    });

    test('startServer returns a valid port number', () => {
        expect(port).toBeDefined();
        expect(typeof port).toBe('number');
        expect(port).toBeGreaterThan(0);
    });

    test('startServer returns an EventLog', () => {
        expect(server.eventLog).toBeDefined();
        expect(typeof server.eventLog.append).toBe('function');
        expect(typeof server.eventLog.subscribe).toBe('function');
    });

    test('server responds to HTTP health check', async () => {
        const resp = await fetch(`http://127.0.0.1:${port}/api/status`);
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.status).toBe('ok');
    });
});
