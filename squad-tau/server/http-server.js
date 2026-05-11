import { createServer } from 'http';
import { DEFAULTS } from './constants.js';

export async function createHttpServer({ viteMiddlewares }) {
    const app = createBasicApp();

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

    if (viteMiddlewares) {
        app.use(viteMiddlewares);
    }

    const server = createServer(app);
    const port = await allocatePort(server);
    app.port = port;

    return {
        app,
        server,
        port,
        close: () =>
            new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            }),
    };
}

function createBasicApp() {
    const middlewares = [];

    const app = (req, res) => {
        let index = 0;
        const next = (err) => {
            if (err) return handleMiddlewareError(res);
            if (index >= middlewares.length) return handleNotFound(res);
            const middleware = middlewares[index++];
            middleware(req, res, next);
        };
        next();
    };

    setupAppMethods(app, middlewares);
    return app;
}

function handleMiddlewareError(res) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
}

function handleNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

function setupAppMethods(app, middlewares) {
    app.use = (middleware) => {
        middlewares.push(middleware);
    };

    app.get = (path, handler) => {
        middlewares.push((req, res, next) => {
            if (req.method === 'GET' && req.url === path) {
                handler(req, res);
            } else {
                next();
            }
        });
    };
}

async function allocatePort(server) {
    let port = DEFAULTS.PORT;
    let attempts = 0;

    while (attempts < DEFAULTS.MAX_PORT_ATTEMPTS) {
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, '127.0.0.1', () => {
                    server.removeListener('error', reject);
                    resolve();
                });
            });
            return port;
        } catch (err) {
            if (err.code === 'EADDRINUSE') {
                port++;
                attempts++;
            } else {
                throw err;
            }
        }
    }

    throw new Error(`Failed to allocate port after ${DEFAULTS.MAX_PORT_ATTEMPTS} attempts`);
}
