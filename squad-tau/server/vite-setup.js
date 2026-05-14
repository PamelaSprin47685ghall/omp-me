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
        server: { middlewareMode: true, appType: 'spa', hmr: false, ws: false },
        clearScreen: false,
        customLogger: {
            info(msg, opts) {
                if (msg.includes('Re-optimizing dependencies')) return;
                if (opts?.clear) console.clear();
                console.log(msg);
            },
            warn(msg) {
                console.warn(msg);
            },
            warnOnce(msg) {
                console.warn(msg);
            },
            error(msg) {
                console.error(msg);
            },
        },
        esbuild: {
            jsxFactory: 'React.createElement',
            jsxFragment: 'React.Fragment',
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
