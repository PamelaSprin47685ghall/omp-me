/**
 * oh-rpiv-advisor — oh-my-pi extension adaptor for @juicesharp/rpiv-advisor
 *
 * Wraps rpiv-advisor's pi extension (https://www.npmjs.com/package/@juicesharp/rpiv-advisor)
 * as an oh-my-pi extension, following the same adaptor pattern as oh-taskplane,
 * oh-studio, and oh-tau-mirror.
 *
 * rpiv-advisor registers the `advisor` tool, the `/advisor` command, and
 * lifecycle hooks (session_start restore, before_agent_start strip).
 *
 * The bridge provides:
 *   - All ExtensionAPI methods rpiv-advisor calls at runtime
 *   - The `pi` property (full @oh-my-pi/pi-coding-agent module) for convertToLlm
 *   - The `typebox` property (TypeBox) for tool schema generation
 *
 * All external imports use file:// paths (AGENTS.md pattern) instead of
 * bare package specifiers.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Inject the `pi.pi` module reference needed for pi.pi.convertToLlm().
// ---------------------------------------------------------------------------

/**
 * Lazy-load and cache the oh-my-pi pi-coding-agent module.
 * Accessed via the bridge's `pi` property. We resolve it from the global
 * install directory, matching the shim pattern used by the other packages.
 */
let _piMod = null;
async function getPiMod() {
	if (!_piMod) {
		const { homedir } = await import("node:os");
		const { join: joinPath } = await import("node:path");
		const base = joinPath(homedir(), ".bun/install/global/node_modules/@oh-my-pi");
		const piAgentPath = joinPath(base, "pi-coding-agent/src/index.ts");
		_piMod = await import("file://" + piAgentPath);
	}
	return _piMod;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

const UNSUPPORTED_EVENTS = new Set([
	"model_select",
]);

export default async function ohRpivAdvisorAdaptor(pi) {
	// Resolve rpiv-advisor's extension entry from the npm-installed package.
	const __dirname = fileURLToPath(new URL(".", import.meta.url));
	const extPath = join(__dirname, "node_modules", "@juicesharp", "rpiv-advisor", "index.ts");

	const { default: rpivAdvisorExtension } = await import("file://" + extPath);

	const piMod = await getPiMod();
	const bridge = createBridge(pi, piMod);
	rpivAdvisorExtension(bridge);
}

/**
 * Create a bridge from oh-my-pi ExtensionAPI to the original
 * @mariozechner/pi-coding-agent ExtensionAPI that rpiv-advisor expects.
 */
export function createBridge(pi, piMod) {
	return {
		// Module access — used by rpiv-advisor for pi.pi.convertToLlm()
		pi: piMod,
		typebox: pi.typebox,

		// Tool registration
		registerTool(toolDef) {
			pi.registerTool(toolDef);
		},

		// Command registration
		registerCommand(name, opts) {
			pi.registerCommand(name, opts);
		},

		// Event subscription — map where names differ, drop unsupported
		on(event, handler) {
			if (UNSUPPORTED_EVENTS.has(event)) return;
			pi.on(event, handler);
		},

		// Messaging
		sendMessage(msg, opts) {
			pi.sendMessage(msg, opts);
		},

		sendUserMessage(content, opts) {
			pi.sendUserMessage(content, opts);
		},

		appendEntry(customType, data) {
			pi.appendEntry(customType, data);
		},

		// Model / Session
		setModel(model) {
			return pi.setModel(model);
		},

		getSessionName() {
			return pi.getSessionName();
		},

		setSessionName(name) {
			return pi.setSessionName(name);
		},

		getThinkingLevel() {
			return pi.getThinkingLevel();
		},

		setThinkingLevel(level) {
			pi.setThinkingLevel(level);
		},

		// Tools
		getActiveTools() {
			return pi.getActiveTools();
		},

		getAllTools() {
			return pi.getAllTools();
		},

		setActiveTools(toolNames) {
			return pi.setActiveTools(toolNames);
		},

		// Label
		setLabel(label) {
			pi.setLabel(label);
		},
	};
}
