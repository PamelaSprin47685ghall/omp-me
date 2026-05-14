import { createServer } from 'http';
import { join } from 'path';
import { readFileSync } from 'fs';

/**
 * Create a middleware-based HTTP app.
 * Returns { app, attach } where:
 *   app — the middleware request handler
 *   attach(server) — adds the app as request listener to an existing server
 */
export function createApp() {
    const stack = [];

    const app = (req, res) => {
        const _indexHtmlPath = app._indexHtmlPath;
        let i = 0;
        const next = (err) => {
            if (err) return handleError(res, err);
            if (i >= stack.length) return handleNotFound(req, res, _indexHtmlPath);
            const mw = stack[i++];

            if (req.url.startsWith('/api/') && mw._isVite) {
                return handleNotFound(req, res, _indexHtmlPath);
            }
            mw(req, res, next);
        };
        next();
    };

    app.use = (mw, opts = {}) => {
        if (opts.isVite) mw._isVite = true;
        stack.push(mw);
    };

    app.get = (path, handler) =>
        stack.push((req, res, next) => {
            req.method === 'GET' && req.url === path ? handler(req, res) : next();
        });

    function attach(server) {
        server.on('request', app);
    }

    return { app, attach };
}

function handleError(res, err) {
    if (err) console.error('Middleware error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(err ? err.stack : 'Internal Server Error');
}

function handleNotFound(req, res, indexHtmlPath) {
    const isFileRequest = req.url.includes('.');
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !isFileRequest && indexHtmlPath) {
        try {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(readFileSync(indexHtmlPath, 'utf8'));
            return;
        } catch {}
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

/**
 * Create and bind an HTTP server.
 * Can optionally receive a pre-created server (for sharing with Vite's WS).
 * Returns { server, port, close }.
 */
export async function createHttpServer({ viteMiddlewares, server: existingServer, clientRoot } = {}) {
    const { app, attach } = createApp();

    app.get('/api/status', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
                status: 'ok',
                port: app.port,
                uptime: process.uptime(),
            }),
        );
    });

    if (viteMiddlewares) app.use(viteMiddlewares, { isVite: true });

    app._indexHtmlPath = clientRoot ? join(clientRoot, 'index.html') : null;

    const server = existingServer || createServer();
    attach(server);

    const port = await bind(server);
    app.port = port;

    return {
        server,
        port,
        close: () => new Promise((r) => server.close(() => r())),
    };
}

function bind(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            const addr = server.address();
            resolve(typeof addr === 'object' ? addr.port : 0);
        });
    });
}
