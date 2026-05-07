/**
 * Shim: @mariozechner/pi-coding-agent — re-exports from oh-my-pi's global
 * install. Provides DynamicBorder for advisor-ui.ts and convertToLlm for
 * the advisor tool's conversation-branch serialization.
 */

import { homedir } from "node:os";
import { join } from "node:path";

const BASE = join(homedir(), ".bun/install/global/node_modules/@oh-my-pi");

// DynamicBorder — render() accesses theme.boxSharp at call time
const DB_PATH = join(BASE, "pi-coding-agent/src/modes/components/dynamic-border.ts");
const _dbMod = await import("file://" + DB_PATH);

// convertToLlm from session/messages.ts
const MSG_PATH = join(BASE, "pi-coding-agent/src/session/messages.ts");
const _msgMod = await import("file://" + MSG_PATH);

export const DynamicBorder = _dbMod.DynamicBorder;
export const convertToLlm = _msgMod.convertToLlm;

// ---------------------------------------------------------------------------
// ModelRegistry.getApiKeyAndHeaders — missing from oh-my-pi's ModelRegistry;
// rpiv-advisor uses it to obtain API key + request headers for the advisor
// model at runtime. Patch the prototype so ctx.modelRegistry exposes it.
// ---------------------------------------------------------------------------

const REGISTRY_PATH = join(BASE, "pi-coding-agent/src/config/model-registry.ts");
try {
	const { ModelRegistry } = await import("file://" + REGISTRY_PATH);
	if (!ModelRegistry.prototype.getApiKeyAndHeaders) {
		ModelRegistry.prototype.getApiKeyAndHeaders = async function (model) {
			const apiKey = await this.getApiKey(model);
			if (!apiKey) {
				return { ok: false, error: `No API key for ${model.provider}` };
			}
			const headers = { Authorization: `Bearer ${apiKey}` };
			return { ok: true, apiKey, headers };
		};
	}
} catch {
	// best effort
}
