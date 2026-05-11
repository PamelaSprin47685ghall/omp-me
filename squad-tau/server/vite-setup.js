import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let viteServer = null;

export async function createViteDevServer() {
    if ((process.env.NODE_ENV === 'test' && !process.env.SQUAD_E2E) || process.env.SKIP_VITE === 'true') {
        return (req, res, next) => next();
    }
    if (viteServer) return viteServer.middlewares;

    let vite;
    try {
        vite = await import('vite');
    } catch (err) {
        throw new Error('Failed to dynamically import vite. ' + 'Ensure vite is installed: npm install -D vite');
    }

    viteServer = await vite.createServer({
        root: join(__dirname, '../client'),
        server: {
            middlewareMode: true,
            hmr: false,
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
        await viteServer.close();
        viteServer = null;
    }
}
