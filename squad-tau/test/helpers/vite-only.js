/**
 * Vite server for dehydrated UI tests.
 * Real Vite dev server (needs JSX compilation), no HMR, no WebSocket.
 */
import { createViteDevServer, CLIENT_ROOT } from '../../server/vite-setup.js';
import { createHttpServer } from '../../server/http-server.js';

let _server = null;

export async function startViteOnly() {
    if (_server) return { port: _server.port };
    // Note: skipVite=false is REQUIRED — Vite compiles JSX for the browser.
    // Without it, raw .jsx files can't be loaded by the page.
    const viteMiddlewares = await createViteDevServer({ skipVite: false });
    const http = await createHttpServer({ viteMiddlewares, clientRoot: CLIENT_ROOT });
    _server = http;
    return { port: http.port };
}

export async function stopViteOnly() {
    if (_server) {
        await _server.close();
        _server = null;
    }
}
