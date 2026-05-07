/**
 * oh-taskplane — oh-my-pi extension adaptor for taskplane
 *
 * Wraps taskplane's pi extension (https://www.npmjs.com/package/taskplane)
 * as an oh-my-pi extension, following the same pattern as plan-exec,
 * advisor, and ollama-search.
 *
 * All external imports use file:// paths (AGENTS.md pattern) instead of
 * bare package specifiers, avoiding Bun's module resolution pitfalls and
 * preventing unnecessary peer-dep installation.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION_END = "session_end";
const SESSION_SHUTDOWN = "session_shutdown";

export default async function ohTaskplaneAdaptor(pi) {
	// Register a before-taskplane session_start handler that suppresses
	// the "Run: pi update" notification — that message targets the original
	// pi CLI, not oh-my-pi.
	pi.on("session_start", (_event, ctx) => {
		const _orig = ctx.ui.notify.bind(ctx.ui);
		ctx.ui.notify = (msg, type) => {
			if (typeof msg === "string" && msg.includes("pi update")) return;
			_orig(msg, type);
		};
	});

	// Resolve taskplane's extension entry from the npm-installed package.
	// AGENTS.md: use file:// paths, not bare package-name specifiers.
	const __dirname = fileURLToPath(new URL(".", import.meta.url));
	const extPath = join(__dirname, "node_modules", "taskplane", "extensions", "taskplane", "extension.ts");

	const { default: taskplaneExtension } = await import("file://" + extPath);

	const bridge = createBridge(pi);
	taskplaneExtension(bridge);
}

/**
 * Create a bridge from oh-my-pi ExtensionAPI to the original pi ExtensionAPI.
 *
 * Most methods pass through directly. The only event name difference
 * bridged is session_end → session_shutdown.
 */
export function createBridge(pi) {
	return {
		registerTool(toolDef) {
			pi.registerTool(toolDef);
		},

		registerCommand(name, opts) {
			pi.registerCommand(name, opts);
		},

		on(event, handler) {
			if (event === SESSION_END) {
				// taskplane expects "session_end"; oh-my-pi uses "session_shutdown"
				pi.on(SESSION_SHUTDOWN, handler);
			} else {
				pi.on(event, handler);
			}
		},

		sendMessage(msg, opts) {
			pi.sendMessage(msg, opts);
		},

		sendUserMessage(content, opts) {
			pi.sendUserMessage(content, opts);
		},

		setModel(model) {
			return pi.setModel(model);
		},

		setLabel(label) {
			pi.setLabel(label);
		},
	};
}
