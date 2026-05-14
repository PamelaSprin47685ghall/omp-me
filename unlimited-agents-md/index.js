/**
 * unlimited-agents-md — removes the 200-file cap on AGENTS.md discovery.
 *
 * Patches AGENTS_MD_LIMIT to Number.MAX_SAFE_INTEGER so
 * system-prompt.ts:483 includes every discovered file.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { getPiBase } = await import('@oh-my-pi/resolve-pi');
const PI_BASE = getPiBase();

const mod = await import(pathToFileURL(join(PI_BASE, 'pi-coding-agent/src/workspace-tree.ts')).href);
mod.AGENTS_MD_LIMIT = Number.MAX_SAFE_INTEGER;

// Remove the 5MB per-file cap — AGENTS.md files are now inlined as full content
// regardless of size (only bounded by context window).
const fpMod = await import(pathToFileURL(join(PI_BASE, 'pi-coding-agent/src/cli/file-processor.ts')).href);
fpMod.MAX_CLI_TEXT_BYTES = Number.MAX_SAFE_INTEGER;
fpMod.MAX_CLI_IMAGE_BYTES = Number.MAX_SAFE_INTEGER;

export default async function unlimitedAgentsMdExtension() {
    // Already patched at module scope
}
