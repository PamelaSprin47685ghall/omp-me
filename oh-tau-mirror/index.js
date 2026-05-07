/**
 * oh-tau-mirror — oh-my-pi extension adaptor for tau-mirror
 *
 * Wraps tau-mirror's pi extension (https://www.npmjs.com/package/tau-mirror)
 * as an oh-my-pi extension, following the same pattern as oh-taskplane,
 * oh-studio, advisor, and ollama-search.
 *
 * tau-mirror's extension entry is at ./extensions/mirror-server.ts in the
 * npm package. It only uses `import type` for @mariozechner/pi-coding-agent
 * (erased at runtime), so no shim package is needed.
 *
 * All external imports use file:// paths (AGENTS.md pattern) instead of
 * bare package specifiers, avoiding Bun's module resolution pitfalls and
 * preventing unnecessary peer-dep installation.
 *
 * tau-mirror's console.log/error calls (e.g. "[Mirror] Browser client connected")
 * are suppressed globally — they clutter the TUI and carry no actionable
 * information for the user.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Suppress tau-mirror's console noise entirely
// ---------------------------------------------------------------------------

console.log = () => {};
console.warn = () => {};
console.error = () => {};

// ---------------------------------------------------------------------------
// Events that exist in the original @mariozechner/pi-coding-agent ExtensionAPI
// but have no direct equivalent in oh-my-pi's ExtensionAPI.
// ---------------------------------------------------------------------------

const UNSUPPORTED_EVENTS = new Set(['model_select']);

export default async function ohTauMirrorAdaptor(pi) {
    // Resolve tau-mirror's extension entry from the npm-installed package.
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const extPath = join(__dirname, 'node_modules', 'tau-mirror', 'extensions', 'mirror-server.ts');

    const { default: tauMirrorExtension } = await import('file://' + extPath);

    const bridge = createBridge(pi);
    tauMirrorExtension(bridge);
}

/**
 * Create a bridge from oh-my-pi ExtensionAPI to the original
 * @mariozechner/pi-coding-agent ExtensionAPI that tau-mirror expects.
 *
 * tau-mirror uses these ExtensionAPI methods:
 *   registerCommand, on, sendUserMessage,
 *   getSessionName, setSessionName,
 *   getThinkingLevel, setThinkingLevel,
 *   setModel
 *
 * And these ExtensionCommandContext/ExtensionContext properties (passthrough):
 *   ctx.ui.notify, ctx.ui.setStatus,
 *   ctx.sessionManager.getSessionFile, ctx.sessionManager.getEntries,
 *   ctx.cwd, ctx.model, ctx.isIdle(), ctx.getContextUsage(), ctx.abort()
 *
 * model_select is silently dropped — oh-my-pi doesn't fire this event.
 */
export function createBridge(pi) {
    return {
        registerCommand(name, opts) {
            pi.registerCommand(name, opts);
        },

        on(event, handler) {
            if (UNSUPPORTED_EVENTS.has(event)) {
                // oh-my-pi does not fire model_select; handler never runs.
                return;
            }
            pi.on(event, handler);
        },

        sendUserMessage(content, opts) {
            pi.sendUserMessage(content, opts);
        },

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
    };
}
