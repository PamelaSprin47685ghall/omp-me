/** oh-my-pi plugin shim — resolves index.js relative to the caller's shim.mjs location. */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function resolvePluginPath(importMetaUrl) {
    const idx = importMetaUrl.lastIndexOf('/shim.mjs');
    if (idx === -1) throw new Error('Cannot locate shim.mjs: ' + importMetaUrl);
    let dir = importMetaUrl.slice(0, idx);
    const NS = 'omp-legacy-pi-file:';
    const nsIdx = dir.indexOf(NS);
    if (nsIdx !== -1) dir = dir.slice(nsIdx + NS.length);
    else if (dir.startsWith('file://')) dir = dir.slice(7);
    else if (dir.startsWith('file:/')) dir = dir.slice(5);
    if (/^\/[A-Za-z]:/.test(dir)) dir = dir.slice(1);
    return pathToFileURL(resolve(dir, 'index.js')).href;
}

export async function loadPlugin(importMetaUrl) {
    const mod = await import(resolvePluginPath(importMetaUrl));
    return mod.default;
}
