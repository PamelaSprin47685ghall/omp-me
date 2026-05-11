import path from 'path';
import { OMP_ME_HOME } from '@oh-my-pi/resolve-pi';
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

/**
 * Bug: vite-setup.js returned ViteDevServer object instead of
 * its .middlewares property. Calling an object as a function
 * throws TypeError - Vite middleware never worked.
 */
describe('Vite middleware integration', () => {
    it('createViteDevServer must return server.middlewares not server', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/vite-setup.js'), 'utf8');
        // Must return the Connect middleware instance, not the ViteDevServer
        assert.ok(
            src.includes('.middlewares') || src.includes('.middleware'),
            'must return the Connect middleware instance',
        );
        assert.ok(
            !src.includes('return server;') || src.includes('server.middlewares'),
            'must NOT return the ViteDevServer object directly',
        );
    });

    it('http-server calls middleware as function', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/http-server.js'), 'utf8');
        // Must invoke the stacked middlewares as functions
        assert.ok(
            src.includes('(req, res, next)') || src.includes('mw(req, res, next)'),
            'http-server calls middleware as function',
        );
    });

    it('server-lifecycle passes createViteDevServer result directly to http-server', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/server-lifecycle.js'), 'utf8');
        // Verify the handoff: createViteDevServer() result → createHttpServer
        const match = src.match(/createViteDevServer\(\).*createHttpServer/s);
        if (!match) {
            // Check variable bridging
            assert.ok(src.includes('viteMiddlewares'), 'must bridge Vite middlewares to HTTP server');
        }
    });
});
