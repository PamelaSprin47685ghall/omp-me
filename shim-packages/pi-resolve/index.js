/** Resolve @oh-my-pi/pi-coding-agent from global install. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi');

export function getPiBase() {
    return BASE;
}

let _codingAgentMod = null;

export async function getCodingAgentModule() {
    if (!_codingAgentMod) {
        const piAgentPath = join(BASE, 'pi-coding-agent/src/index.ts');
        _codingAgentMod = await import(pathToFileURL(piAgentPath).href);
    }
    return _codingAgentMod;
}
