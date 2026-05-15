import { join } from 'path';
import { OMP_ME_HOME } from '@oh-my-pi/resolve-pi';

export const CLIENT_ROOT = join(OMP_ME_HOME, 'squad-tau', 'client');

let viteServer = null;

export async function createViteDevServer({ skipVite = false } = {}) {
    if (skipVite) return (req, res, next) => next();

    return startVite();
}

async function startVite() {
    let createServer;
    try {
        const { importNodeModule } = await import('@oh-my-pi/resolve-pi');
        createServer = (await importNodeModule('vite')).createServer;
    } catch {
        createServer = (await import('vite')).createServer;
    }

    viteServer = await createServer({
        root: CLIENT_ROOT,
        server: { middlewareMode: true, appType: 'custom', hmr: false, ws: false },
        clearScreen: false,
        customLogger: {
            info() {},
            warn() {},
            warnOnce() {},
            error() {},
        },
        // Force pre-bundle: Custom Elements with bare imports may be missed
        // by Vite's React-centric dependency crawler in middleware mode.
        optimizeDeps: {
            include: ['marked'],
        },
    });

    return viteServer.middlewares;
}

export async function closeViteServer() {
    if (viteServer) {
        const optimizer = viteServer.environments?.client?.depsOptimizer;
        if (optimizer?.scanProcessing) await optimizer.scanProcessing;
        await viteServer.close();
        viteServer = null;
    }
}
