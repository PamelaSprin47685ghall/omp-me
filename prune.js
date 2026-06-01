import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPiBase } from './pi-resolve.js';

export async function patchDisablePrune() {
    const pruning = await import(pathToFileURL(path.join(getPiBase(), 'pi-agent-core/src/compaction/pruning.ts')).href);
    const config = pruning.DEFAULT_PRUNE_CONFIG;
    if (!config) return;
    for (const key of ['protectTokens', 'minimumSavings']) {
        try {
            config[key] = Number.MAX_SAFE_INTEGER;
        } catch {
            try {
                Object.defineProperty(config, key, { value: Number.MAX_SAFE_INTEGER, configurable: true, writable: true });
            } catch {}
        }
    }
}
