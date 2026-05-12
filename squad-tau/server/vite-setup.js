import { join } from 'path';
import { OMP_ME_HOME } from '@oh-my-pi/resolve-pi';

const CLIENT_ROOT = join(OMP_ME_HOME, 'squad-tau', 'client');

let realMiddleware = null;
let viteServer = null;
let startPromise = null;

/**
 * Create a lazy Vite dev server middleware.
 * Vite is initialized on the first request, not eagerly.
 * HMR is disabled to avoid WebSocket conflict with the ws server.
 */
export async function createViteDevServer() {
    const shouldSkip = (process.env.NODE_ENV === 'test' && !process.env.SQUAD_E2E) || process.env.SKIP_VITE === 'true';
    if (shouldSkip) return (req, res, next) => next();

    // Return a lazy middleware that initializes Vite on first request.
    return (req, res, next) => {
        if (realMiddleware) return realMiddleware(req, res, next);

        // Kick off Vite creation once, share across concurrent first requests.
        if (!startPromise) {
            startPromise = startVite()
                .then((mw) => {
                    realMiddleware = mw;
                    return mw;
                })
                .catch((err) => {
                    // On failure, reset so the next request retries.
                    startPromise = null;
                    throw err;
                });
        }

        startPromise.then((mw) => mw(req, res, next)).catch(next);
    };
}

async function startVite(_httpServer) {
    let createServer;
    try {
        // Try OMP's module resolver first
        const { importNodeModule } = await import('@oh-my-pi/resolve-pi');
        createServer = (await importNodeModule('vite')).createServer;
    } catch {
        // Fall back to regular import (works in test/standalone env)
        createServer = (await import('vite')).createServer;
    }

    viteServer = await createServer({
        root: CLIENT_ROOT,
        server: { middlewareMode: true, appType: 'spa' },
        hmr: false,
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
