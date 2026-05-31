import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPiBase } from './pi-resolve.js';

export async function patchDisablePrune() {
    const pruning = await import(pathToFileURL(path.join(getPiBase(), 'pi-agent-core/src/compaction/pruning.ts')).href);
    pruning.DEFAULT_PRUNE_CONFIG.protectTokens = Number.MAX_SAFE_INTEGER;
    pruning.DEFAULT_PRUNE_CONFIG.minimumSavings = Number.MAX_SAFE_INTEGER;
}
