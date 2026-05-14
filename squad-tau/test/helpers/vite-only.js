/**
 * Bare Vite server for dehydrated UI tests.
 * No WebSocket, no engine, no model pool — just the frontend.
 */
import { createViteDevServer } from '../../server/vite-setup.js';
import { createHttpServer } from '../../server/http-server.js';
import { CLIENT_ROOT } from '../../server/vite-setup.js';

let _server = null;

export async function startViteOnly() {
    if (_server) return { port: _server.port };
    const viteMiddlewares = await createViteDevServer();
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
