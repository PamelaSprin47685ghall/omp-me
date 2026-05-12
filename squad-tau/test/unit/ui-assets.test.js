import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer } from '../../server/server-lifecycle.js';
import path from 'path';
import { OMP_ME_HOME } from '@oh-my-pi/resolve-pi';

describe('UI Asset Resolution', () => {
    let port;

    beforeAll(async () => {
        // We need SQUAD_E2E=true to ensure Vite is not skipped
        process.env.SQUAD_E2E = 'true';
        process.env.NODE_ENV = 'development';
        const result = await startServer();
        port = result.port;
    });

    afterAll(async () => {
        await stopServer();
    });

    test('serves index.html at root /', async () => {
        const resp = await fetch(`http://127.0.0.1:${port}/`);
        expect(resp.status).toBe(200);
        const text = await resp.text();
        expect(text).toContain('<div id="root"></div>');
    });

    test('serves assets from client directory via Vite', async () => {
        // main.jsx is a known asset in squad-tau/client
        const resp = await fetch(`http://127.0.0.1:${port}/main.jsx`);
        expect(resp.status).toBe(200);
        const text = await resp.text();
        expect(text).toContain('createRoot');
    });

    test('returns 404 for non-existent API routes', async () => {
        // API routes are defined before Vite middleware, so they should 404 correctly
        const resp = await fetch(`http://127.0.0.1:${port}/api/non-existent`);
        expect(resp.status).toBe(404);
        const text = await resp.text();
        expect(text).toBe('Not Found');
    });

    test('SPA fallback: non-asset routes should serve index.html', async () => {
        // Since it's configured as appType: 'spa' in vite-setup.js
        const resp = await fetch(`http://127.0.0.1:${port}/some-spa-route`);
        expect(resp.status).toBe(200);
        const text = await resp.text();
        expect(text).toContain('<div id="root"></div>');
    });
});
