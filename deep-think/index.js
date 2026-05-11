/**
 * deep-think — oh-my-pi extension adaptor for @juicesharp/rpiv-advisor
 *
 * Wraps rpiv-advisor's pi extension (https://www.npmjs.com/package/@juicesharp/rpiv-advisor)
 * and renames its tool/command from `advisor` to `deep-think` to boost
 * deep thinking on every invocation.
 *
 * The bridge provides:
 *   - All ExtensionAPI methods rpiv-advisor calls at runtime
 *   - The `pi` property (full @oh-my-pi/pi-coding-agent module) for convertToLlm
 *   - The `typebox` property (TypeBox) for tool schema generation
 *
 * Dependencies resolved through root node_modules (single bun install).
 */

import { getCodingAgentModule, importNodeModule } from '@oh-my-pi/resolve-pi';

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

export default async function deepThinkAdaptor(pi) {
    const { default: rpivAdvisorExtension } = await importNodeModule('@juicesharp/rpiv-advisor');

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
            pi.registerTool({
                ...toolDef,
                name: 'deep-think',
                label: 'Deep Think',
                description:
                    'Spend extra time and depth thinking through complex problems, code review, and architectural decisions.',
                promptSnippet:
                    'Use deep-think when you need extra time and deeper reasoning to work through a complex problem',
                promptGuidelines: [
                    "Call `deep-think` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work; writing, editing, and declaring an answer are.",
                    'Also call `deep-think` when you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change.',
                    "Also call `deep-think` when stuck — errors recurring, approach not converging, results that don't fit — or when considering a change of approach.",
                    "On tasks longer than a few steps, call `deep-think` at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling.",
                    "Give the deep-think output serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the output is wrong, it's evidence your test doesn't check what matters.",
                    'If you\'ve already retrieved data pointing one way and deep-think points another, don\'t silently switch — surface the conflict in one more `deep-think` call (\"I found X, you suggest Y, which constraint breaks the tie?\").',
                ],
            });
        },

        registerCommand(name, opts) {
            pi.registerCommand(
                name === 'advisor' ? 'deep-think' : name,
                name === 'advisor' ? { ...opts, description: 'Configure deep-think for deeper reasoning' } : opts,
            );
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
