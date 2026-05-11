import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

/**
 * PRD §7.4 lists vite as a runtime dependency, but package.json
 * has it under devDependencies. Since vite-setup.js dynamically
 * imports vite at runtime (via squad-engine), it must be in
 * dependencies to be available in production installs.
 */
describe('package.json dependency placement', () => {
    it('vite must be in dependencies (used at runtime by vite-setup.js)', async () => {
        const fs = await import('fs');
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        assert.ok(pkg.dependencies && pkg.dependencies.vite, 'vite must be in dependencies (not devDependencies)');
    });

    it('vite-setup.js dynamically imports vite', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/vite-setup.js', 'utf8');
        assert.ok(src.includes("import('vite')"), 'vite-setup.js dynamically imports vite at runtime');
    });

    it('package.json devDependencies must not contain runtime deps', async () => {
        const fs = await import('fs');
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const runtimeImports = [
            'vite',
            'ws',
            'react',
            'react-dom',
            '@blueprintjs/core',
            '@blueprintjs/icons',
            'mermaid',
        ];
        for (const dep of runtimeImports) {
            const inDev = pkg.devDependencies && pkg.devDependencies[dep];
            const inProd = pkg.dependencies && pkg.dependencies[dep];
            if (inDev) {
                assert.ok(inProd, `${dep} is in devDependencies but must also (or instead) be in dependencies`);
            }
        }
    });
});
