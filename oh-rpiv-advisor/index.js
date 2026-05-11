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
 * Dependencies resolved through root node_modules (single bun install).
 */

import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';

function ensureGetApiKeyAndHeaders(piMod) {
    const ModelRegistry = piMod.ModelRegistry;
    if (!ModelRegistry || ModelRegistry.prototype.getApiKeyAndHeaders) return;
    ModelRegistry.prototype.getApiKeyAndHeaders = async function (model) {
        const apiKey = await this.getApiKey(model);
        if (!apiKey) {
            return { ok: false, error: `No API key for ${model.provider}` };
        }
        const headers = { Authorization: `Bearer ${apiKey}` };
        return { ok: true, apiKey, headers };
    };
}

const UNSUPPORTED_EVENTS = new Set(['model_select']);

export default async function ohRpivAdvisorAdaptor(pi) {
    const { default: rpivAdvisorExtension } = await import('@juicesharp/rpiv-advisor');

    const piMod = await getCodingAgentModule();

    ensureGetApiKeyAndHeaders(piMod);

    const bridge = createBridge(pi, piMod);
    rpivAdvisorExtension(bridge);
}

export function createBridge(pi, piMod) {
    return {
        pi: piMod,
        typebox: pi.typebox,

        registerTool(toolDef) {
            pi.registerTool(toolDef);
        },

        registerCommand(name, opts) {
            pi.registerCommand(name, opts);
        },

        on(event, handler) {
            if (UNSUPPORTED_EVENTS.has(event)) return;
            pi.on(event, handler);
        },

        sendMessage(msg, opts) {
            pi.sendMessage(msg, opts);
        },

        sendUserMessage(content, opts) {
            pi.sendUserMessage(content, opts);
        },

        appendEntry(customType, data) {
            pi.appendEntry(customType, data);
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

        getActiveTools() {
            return pi.getActiveTools();
        },

        getAllTools() {
            return pi.getAllTools();
        },

        setActiveTools(toolNames) {
            return pi.setActiveTools(toolNames);
        },

        setLabel(label) {
            pi.setLabel(label);
        },
    };
}
