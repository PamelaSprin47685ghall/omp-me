import { test, expect } from 'bun:test';
import { createServer } from 'http';
import { createHttpServer } from '../../server/http-server.js';
import { DEFAULTS } from '../../server/constants.js';

test('server starts on default port when available', async () => {
    const { server, port, close } = await createHttpServer({});

    expect(port).toBe(DEFAULTS.PORT);
    expect(server.listening).toBe(true);

    await close();
});

test('fallback to OS-assigned port when default is busy', async () => {
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(DEFAULTS.PORT, '127.0.0.1', resolve));

    const { port, close } = await createHttpServer({});

    expect(port).not.toBe(DEFAULTS.PORT);
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);

    await close();
    await new Promise((resolve) => blocker.close(resolve));
});

test('GET /api/status returns JSON with correct port', async () => {
    const { port, close } = await createHttpServer({});

    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(data.status).toBe('ok');
    expect(data.port).toBe(port);
    expect(typeof data.uptime).toBe('number');

    await close();
});

test('127.0.0.1 binding', async () => {
    const { server, close } = await createHttpServer({});

    const address = server.address();
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');

    await close();
});
