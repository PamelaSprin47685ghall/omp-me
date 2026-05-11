import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

const home = homedir();
const PI_BASE =
    [
        join(home, '.cache/.bun/install/global/node_modules/@oh-my-pi'),
        join(home, '.bun/install/global/node_modules/@oh-my-pi'),
    ].find(existsSync) || join(home, '.bun/install/global/node_modules/@oh-my-pi');

const _thisFile = fileURLToPath(import.meta.url);
function findRoot(dir) {
    while (dir !== dirname(dir)) {
        if (existsSync(join(dir, 'squad-tau', 'client', 'index.html'))) return dir;
        dir = dirname(dir);
    }
    return dir;
}

export const OMP_ME_HOME = findRoot(dirname(_thisFile));
export const getPiBase = () => PI_BASE;

const cache = new Map();

export async function importNodeModule(name, subpath = null) {
    const key = subpath ? `${name}:${subpath}` : name;
    if (cache.has(key)) return cache.get(key);

    const target = await import.meta.resolve(subpath ? `${name}/${subpath}` : name);
    const mod = await import(target);
    cache.set(key, mod);
    return mod;
}

export async function getCodingAgentModule() {
    const key = '@oh-my-pi/pi-coding-agent';
    if (cache.has(key)) return cache.get(key);
    const mod = await import(pathToFileURL(join(PI_BASE, 'pi-coding-agent/src/index.ts')).href);
    cache.set(key, mod);
    return mod;
}
