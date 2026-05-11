import { test, expect } from 'bun:test';
import { createServer } from 'http';
import { createHttpServer } from '../../server/http-server.js';

test('binds to OS-assigned port and returns it', async () => {
    const { port, server, close } = await createHttpServer();

    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(server.listening).toBe(true);

    await close();
});

test('GET /api/status returns JSON with correct port', async () => {
    const { port, close } = await createHttpServer();

    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(data.status).toBe('ok');
    expect(data.port).toBe(port);
    expect(typeof data.uptime).toBe('number');

    await close();
});

test('binds to 127.0.0.1 only', async () => {
    const { server, close } = await createHttpServer();

    const address = server.address();
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');

    await close();
});
