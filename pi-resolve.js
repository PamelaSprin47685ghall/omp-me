import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const home = homedir();
const PI_BASE = [
    join(home, '.cache/.bun/install/global/node_modules/@oh-my-pi'),
    join(home, '.bun/install/global/node_modules/@oh-my-pi'),
].find(existsSync) || join(home, '.bun/install/global/node_modules/@oh-my-pi');

const cache = new Map();

export function getPiBase() {
    return PI_BASE;
}

export async function getCodingAgentModule() {
    const key = '@oh-my-pi/pi-coding-agent';
    if (cache.has(key)) return cache.get(key);
    const module = await import(pathToFileURL(join(PI_BASE, 'pi-coding-agent/src/index.ts')).href);
    cache.set(key, module);
    return module;
}
