import { describe, it, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';

// ── Regression: server must start and return port (REPAIR.md §1) ──
// Note: runs in its own worker thread (node --test isolates test files)
describe('server lifecycle regression', () => {
    let server, port;

    beforeAll(async () => {
        const { startServer } = await import('../../server/server-lifecycle.js');
        server = await startServer({ skipVite: true });
        port = server.port;
    });

    afterAll(async () => {
        const { stopServer } = await import('../../server/server-lifecycle.js');
        await stopServer();
    });

    it('startServer returns a valid port number', () => {
        assert.ok(typeof port === 'number' && port > 0);
    });

    it('startServer returns an EventLog', () => {
        assert.ok(server.eventLog);
        assert.equal(typeof server.eventLog.append, 'function');
        assert.equal(typeof server.eventLog.subscribe, 'function');
    });

    it('server responds to HTTP health check with status ok', async () => {
        const resp = await fetch(`http://127.0.0.1:${port}/api/status`);
        assert.equal(resp.status, 200);
        const body = await resp.json();
        assert.equal(body.status, 'ok');
    });
});
