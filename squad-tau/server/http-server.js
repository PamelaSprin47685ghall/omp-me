import { createServer } from 'http';

/**
 * Create a middleware-based HTTP app.
 * Returns { app, attach } where:
 *   app — the middleware request handler
 *   attach(server) — adds the app as request listener to an existing server
 */
export function createApp() {
    const stack = [];

    const app = (req, res) => {
        let i = 0;
        const next = (err) => {
            if (err) return handleError(res, err);
            if (i >= stack.length) return handleNotFound(res);
            const mw = stack[i++];

            // If it's an API route that didn't match any handler, don't fall through to Vite/SPA
            if (req.url.startsWith('/api/') && mw._isVite) {
                return handleNotFound(res);
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

function handleNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

/**
 * Create and bind an HTTP server.
 * Can optionally receive a pre-created server (for sharing with Vite's WS).
 * Returns { server, port, close }.
 */
export async function createHttpServer({ viteMiddlewares, server: existingServer } = {}) {
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
            resolve(server.address().port);
        });
    });
}
