import { test, expect } from 'bun:test';
import { createServer } from 'http';
import { createHttpServer } from '../../server/http-server.js';
import { DEFAULTS } from '../../server/constants.js';

test('server starts on preferred port when available', async () => {
    // Use a port that is likely free and not DEFAULTS.PORT
    const testPort = 19527;
    const { server, port, close } = await createHttpServer({ port: testPort });

    expect(port).toBe(testPort);
    expect(server.listening).toBe(true);

    await close();
});

test('fallback to OS-assigned port when default is busy', async () => {
    const blocker = createServer();
    let blocked = false;
    try {
        await new Promise((resolve, reject) => {
            blocker.once('error', reject);
            blocker.listen(DEFAULTS.PORT, '127.0.0.1', () => {
                blocked = true;
                resolve();
            });
        });
    } catch (err) {
        // Already blocked by someone else, which is what we want
    }

    const { port, close } = await createHttpServer({});

    expect(port).not.toBe(DEFAULTS.PORT);
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);

    await close();
    if (blocked) {
        await new Promise((resolve) => blocker.close(resolve));
    }
});

test('GET /api/status returns JSON with correct port', async () => {
    const { port, close } = await createHttpServer({ port: 0 });

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
    const { server, close } = await createHttpServer({ port: 0 });

    const address = server.address();
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');

    await close();
});
