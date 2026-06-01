import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const home = homedir();
const PI_BASE_CANDIDATES = [
    join(home, '.cache/.bun/install/global/node_modules/@oh-my-pi'),
    join(home, '.bun/install/global/node_modules/@oh-my-pi'),
];
const PI_BASE = PI_BASE_CANDIDATES.find(existsSync) ?? PI_BASE_CANDIDATES.at(-1);

let cachedModule;

export function getPiBase() {
    return PI_BASE;
}

export async function getCodingAgentModule() {
    if (cachedModule) return cachedModule;
    const module = await import(pathToFileURL(join(PI_BASE, 'pi-coding-agent/src/index.ts')).href);
    cachedModule = module;
    return module;
}
