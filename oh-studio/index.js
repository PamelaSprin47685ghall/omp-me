/**
 * oh-studio — oh-my-pi extension adaptor for pi-studio
 *
 * Wraps pi-studio's pi extension (https://www.npmjs.com/package/pi-studio)
 * as an oh-my-pi extension, following the same pattern as oh-taskplane,
 * plan-exec, advisor, and ollama-search.
 *
 * All external imports use file:// paths (AGENTS.md pattern) instead of
 * bare package specifiers, avoiding Bun's module resolution pitfalls and
 * preventing unnecessary peer-dep installation.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// pi-studio event names that differ between @mariozechner/pi-coding-agent and
// oh-my-pi's ExtensionAPI
// ---------------------------------------------------------------------------

/**
 * Events that exist in the original @mariozechner/pi-coding-agent ExtensionAPI
 * but have no direct equivalent in oh-my-pi's ExtensionAPI.
 * Handlers for these are silently ignored.
 */
const UNSUPPORTED_EVENTS = new Set(['model_select']);

export default async function ohStudioAdaptor(pi) {
    // Resolve pi-studio's extension entry from the npm-installed package.
    // AGENTS.md: use file:// paths, not bare package-name specifiers.
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const extPath = join(__dirname, 'node_modules', 'pi-studio', 'index.ts');

    const { default: studioExtension } = await import('file://' + extPath);

    const bridge = createBridge(pi);
    studioExtension(bridge);
}

/**
 * Create a bridge from oh-my-pi ExtensionAPI to the original
 * @mariozechner/pi-coding-agent ExtensionAPI that pi-studio expects.
 *
 * Most methods pass through directly. Events that differ between the two
 * APIs are mapped or silently dropped.
 *
 * The ExtensionCommandContext passed to command handlers (ctx) is the
 * native oh-my-pi context — pi-studio accesses `ctx.cwd`, `ctx.model`,
 * `ctx.ui.notify()`, `ctx.waitForIdle()`, `ctx.sessionManager.getBranch()`,
 * and `ctx.getContextUsage()`, all of which exist on oh-my-pi's context.
 */
export function createBridge(pi) {
    return {
        // -------------------------------------------------------------------
        // Tool registration — direct passthrough
        // -------------------------------------------------------------------
        registerTool(toolDef) {
            pi.registerTool(toolDef);
        },

        // -------------------------------------------------------------------
        // Command registration — direct passthrough
        // -------------------------------------------------------------------
        registerCommand(name, opts) {
            pi.registerCommand(name, opts);
        },

        // -------------------------------------------------------------------
        // Event subscription — map where names differ, skip unsupported
        // -------------------------------------------------------------------
        on(event, handler) {
            if (UNSUPPORTED_EVENTS.has(event)) {
                // oh-my-pi does not fire model_select; handler never runs.
                // The handler only refreshes metadata for the Studio UI — no
                // critical behavior depends on it.
                return;
            }
            pi.on(event, handler);
        },

        // -------------------------------------------------------------------
        // Messaging — direct passthrough
        // -------------------------------------------------------------------
        sendMessage(msg, opts) {
            pi.sendMessage(msg, opts);
        },

        sendUserMessage(content, opts) {
            pi.sendUserMessage(content, opts);
        },

        appendEntry(type, data) {
            pi.appendEntry(type, data);
        },

        // -------------------------------------------------------------------
        // Model / Session metadata — direct passthrough
        // -------------------------------------------------------------------
        setModel(model) {
            return pi.setModel(model);
        },

        getSessionName() {
            return pi.getSessionName();
        },

        getThinkingLevel() {
            return pi.getThinkingLevel();
        },

        // -------------------------------------------------------------------
        // Label — direct passthrough
        // -------------------------------------------------------------------
        setLabel(label) {
            pi.setLabel(label);
        },
    };
}
