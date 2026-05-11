import { join } from 'path';
import { OMP_ME_HOME } from '@oh-my-pi/resolve-pi';

const CLIENT_ROOT = join(OMP_ME_HOME, 'squad-tau', 'client');

let realMiddleware = null;
let viteServer = null;
let startPromise = null;

/**
 * Create a lazy Vite dev server middleware.
 * Vite is initialized on the first request, not eagerly.
 * Optionally accepts an http.Server instance for Vite to attach its WebSocket to.
 */
export async function createViteDevServer({ httpServer } = {}) {
    const shouldSkip = (process.env.NODE_ENV === 'test' && !process.env.SQUAD_E2E) || process.env.SKIP_VITE === 'true';
    if (shouldSkip) return (req, res, next) => next();

    // Return a lazy middleware that initializes Vite on first request.
    return (req, res, next) => {
        if (realMiddleware) return realMiddleware(req, res, next);

        // Kick off Vite creation once, share across concurrent first requests.
        if (!startPromise) {
            startPromise = startVite(httpServer).then((mw) => {
                realMiddleware = mw;
                return mw;
            });
        }

        startPromise.then((mw) => mw(req, res, next)).catch(next);
    };
}

async function startVite(httpServer) {
    const { importNodeModule } = await import('@oh-my-pi/resolve-pi');
    const { createServer } = await importNodeModule('vite');
    const serverOpts = { middlewareMode: true, appType: 'spa' };
    if (httpServer) {
        serverOpts.hmr = { server: httpServer };
    }

    viteServer = await createServer({
        root: CLIENT_ROOT,
        server: serverOpts,
        clearScreen: false,
        esbuild: {
            jsxFactory: 'React.createElement',
            jsxFragment: 'React.Fragment',
        },
    });

    return viteServer.middlewares;
}

export async function closeViteServer() {
    if (viteServer) {
        // Wait for the background dep-scan to finish before closing,
        // otherwise Vite throws "server is being restarted or closed"
        // when the scan's resolveId call hits a closed plugin container.
        const optimizer = viteServer.environments?.client?.depsOptimizer;
        if (optimizer?.scanProcessing) await optimizer.scanProcessing;
        await viteServer.close();
        viteServer = null;
    }
    realMiddleware = null;
    startPromise = null;
}
