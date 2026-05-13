/**
 * disable-prune — oh-my-pi extension that disables tool result pruning.
 *
 * Monkey-patches DEFAULT_PRUNE_CONFIG's protectTokens and minimumSavings
 * to infinity so pruneToolOutputs() never accumulates enough to trigger.
 *
 * The object's properties are mutable even though the ESM namespace is frozen,
 * and the running AgentSession already holds a reference to the same object.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { getPiBase } = await import('@oh-my-pi/resolve-pi');
const PI_BASE = getPiBase();

// Directly import the pruning module from the bun cache, bypassing export maps.
const mod = await import(pathToFileURL(join(PI_BASE, 'pi-coding-agent/src/session/compaction/pruning.ts')).href);

// Prevent any tool result from ever being pruned.
mod.DEFAULT_PRUNE_CONFIG.protectTokens = Number.MAX_SAFE_INTEGER;
mod.DEFAULT_PRUNE_CONFIG.minimumSavings = Number.MAX_SAFE_INTEGER;

export default async function disablePruneExtension() {
    // Extension already patched DEFAULT_PRUNE_CONFIG at module scope
}
