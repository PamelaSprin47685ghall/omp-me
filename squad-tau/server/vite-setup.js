import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function createViteDevServer() {
    let vite;
    try {
        vite = await import('vite');
    } catch (err) {
        throw new Error('Failed to dynamically import vite. ' + 'Ensure vite is installed: npm install -D vite');
    }

    const server = await vite.createServer({
        root: join(__dirname, '../client'),
        server: {
            middlewareMode: true,
        },
        esbuild: {
            jsxFactory: 'React.createElement',
            jsxFragment: 'React.Fragment',
            jsxInject: "import React from 'react'",
        },
    });

    return server;
}
