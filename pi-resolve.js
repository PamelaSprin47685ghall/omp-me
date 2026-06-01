import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const home = homedir();
const PI_BASE_CANDIDATES = [
    process.env.PI_BASE,
    join(home, '.cache/.bun/install/global/node_modules/@oh-my-pi'),
    join(home, '.bun/install/global/node_modules/@oh-my-pi'),
].filter(Boolean);

let resolvedBase;
function resolveBase() {
    if (resolvedBase) return resolvedBase;
    const found = PI_BASE_CANDIDATES.find(existsSync);
    if (!found) {
        throw new Error(
            `Cannot locate @oh-my-pi base path. Tried:\n${PI_BASE_CANDIDATES.map((p) => `  - ${p}`).join('\n')}\n` +
            `Set PI_BASE environment variable to the @oh-my-pi install root.`
        );
    }
    resolvedBase = found;
    return resolvedBase;
}

let cachedModule;

export function getPiBase() {
    return resolveBase();
}

export async function getCodingAgentModule() {
    if (cachedModule) return cachedModule;
    const module = await import(pathToFileURL(join(resolveBase(), 'pi-coding-agent/src/index.ts')).href);
    cachedModule = module;
    return module;
}
