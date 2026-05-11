import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { createHttpServer } from '../../server/http-server.js';

test('server starts on port 9527', async () => {
    const { server, port, close } = await createHttpServer({});

    assert.equal(port, 9527);
    assert.ok(server.listening);

    await close();
});

test('GET /api/status returns JSON', async () => {
    const { port, close } = await createHttpServer({});

    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(data.status, 'ok');
    assert.equal(data.port, port);
    assert.ok(typeof data.uptime === 'number');

    await close();
});

test('port increment on conflict', async () => {
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(9527, '127.0.0.1', resolve));

    const { port, close } = await createHttpServer({});

    assert.equal(port, 9528);

    await close();
    await new Promise((resolve) => blocker.close(resolve));
});

test('127.0.0.1 binding', async () => {
    const { server, close } = await createHttpServer({});

    const address = server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.family, 'IPv4');

    await close();
});
