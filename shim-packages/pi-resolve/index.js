/**
 * pi-resolve: resolves pi-coding-agent, pi-ai, pi-tui from global install,
 * and provides createRequire-based external module loading for OMP plugins.
 *
 * OMP loads plugins from a temp directory, causing bare specifier resolution
 * failures for packages like `ws`. `requireScoped` solves this by creating a
 * require() scoped to the calling module's actual filesystem path.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Detect correct bun install path
function detectBunBase() {
    const home = homedir();
    const paths = [
        join(home, '.cache/.bun/install/global/node_modules/@oh-my-pi'),
        join(home, '.bun/install/global/node_modules/@oh-my-pi'),
    ];

    for (const path of paths) {
        if (existsSync(path)) {
            return path;
        }
    }

    // Fallback to .cache path if neither exists
    return paths[0];
}

const BASE = detectBunBase();

export function getPiBase() {
    return BASE;
}

let _codingAgentMod = null;

/**
 * Get the @oh-my-pi/pi-coding-agent module from the global Bun install.
 */
export async function getCodingAgentModule() {
    if (!_codingAgentMod) {
        const piAgentPath = join(BASE, 'pi-coding-agent/src/index.ts');
        _codingAgentMod = await import(pathToFileURL(piAgentPath).href);
    }
    return _codingAgentMod;
}

/**
 * Create a CommonJS require() function scoped to the calling module's
 * directory. Use this to load external npm packages (like `ws`, `vite`)
 * without OMP's temp-directory resolution issues.
 *
 * @param {string} importMetaUrl - Pass `import.meta.url` from the caller.
 * @returns {NodeRequire}
 */
export function requireScoped(importMetaUrl) {
    const __filename = fileURLToPath(importMetaUrl);
    return createRequire(join(dirname(__filename), 'noop.js'));
}
