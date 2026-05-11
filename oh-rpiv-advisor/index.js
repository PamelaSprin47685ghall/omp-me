/**
 * oh-rpiv-advisor — oh-my-pi extension adaptor for @juicesharp/rpiv-advisor
 *
 * Wraps rpiv-advisor's pi extension as an oh-my-pi extension.
 *
 * Monkey-patches pi.registerTool to:
 *   1. Capture the advisor tool's execute() for auto-triggering
 *   2. Wrap todo_write's execute() to inject advisor review before todo ops
 *
 * Registers before_agent_start to auto-consult the advisor on every prompt.
 * Keeps the original LLM-triggered `advisor` tool intact.
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

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Create a Proxy around ctx that prepends an extra user message to the
 * session branch seen by getBranch(). Used to inject the current user prompt
 * (not yet in the branch) for auto-advisor calls from before_agent_start.
 */
function withExtraUserMessage(ctx, text, images) {
    const branch = ctx.sessionManager.getBranch();
    const extraEntry = {
        type: 'message',
        message: {
            role: 'user',
            content: [{ type: 'text', text }],
            timestamp: Date.now(),
        },
    };
    if (images?.length) {
        extraEntry.message.content.push(...images);
    }

    const branchWithExtra = [...branch, extraEntry];

    return new Proxy(ctx, {
        get(target, prop, receiver) {
            if (prop === 'sessionManager') {
                return new Proxy(target.sessionManager, {
                    get(sm, smProp) {
                        if (smProp === 'getBranch') return () => branchWithExtra;
                        const val = Reflect.get(sm, smProp, sm);
                        return typeof val === 'function' ? val.bind(sm) : val;
                    },
                });
            }
            const val = Reflect.get(target, prop, receiver);
            return typeof val === 'function' ? val.bind(target) : val;
        },
    });
}

/**
 * Extract text from an AgentToolResult, or null if the result is an error.
 */
function resultText(result) {
    if (result.details?.errorMessage) return null;
    const text = result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim();
    return text || null;
}

// ── bridge ─────────────────────────────────────────────────────────────────

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

// ── extension entry point ──────────────────────────────────────────────────

export default async function ohRpivAdvisorAdaptor(pi) {
    const piMod = await getCodingAgentModule();

    ensureGetApiKeyAndHeaders(piMod);

    // ── monkey-patch registerTool ──────────────────────────────────────────
    // 1. Capture the advisor tool definition (including its execute closure)
    //    so auto-trigger handlers can call the real executeAdvisor.
    // 2. Wrap any todo_write tool so it consults the advisor before executing.

    const toolDefs = new Map();
    const origRegisterTool = pi.registerTool.bind(pi);

    pi.registerTool = function (toolDef) {
        toolDefs.set(toolDef.name, toolDef);

        if (toolDef.name === 'todo_write') {
            const origExecute = toolDef.execute;
            toolDef.execute = async function (toolCallId, params, signal, onUpdate, ctx) {
                // Call advisor before the todo operation
                const advisorDef = toolDefs.get('advisor');
                let advice = null;

                if (advisorDef?.execute) {
                    const extraMsg = `Review this todo operation before execution:\n${JSON.stringify(params, null, 2)}`;
                    const ctxWithPrompt = withExtraUserMessage(ctx, extraMsg);

                    const ctrl = new AbortController();
                    const t = setTimeout(() => ctrl.abort(), 30000);
                    if (signal)
                        signal.addEventListener(
                            'abort',
                            () => {
                                clearTimeout(t);
                                ctrl.abort();
                            },
                            { once: true },
                        );

                    try {
                        const res = await advisorDef.execute('auto_todo', {}, ctrl.signal, undefined, ctxWithPrompt);
                        advice = resultText(res);
                    } catch {
                        // advisor failure must not block the todo operation
                    } finally {
                        clearTimeout(t);
                    }
                }

                const result = await origExecute.call(this, toolCallId, params, signal, onUpdate, ctx);

                if (advice) {
                    const block = `\n\n--- Advisor Review ---\n${advice}`;
                    const textContent = result.content?.find((c) => c.type === 'text');
                    if (textContent) {
                        textContent.text += block;
                    } else {
                        result.content = [...(result.content || []), { type: 'text', text: block }];
                    }
                }

                return result;
            };
        }

        return origRegisterTool(toolDef);
    };

    // ── auto-advisor on every prompt ───────────────────────────────────────
    pi.on('before_agent_start', async (event, ctx) => {
        const advisorDef = toolDefs.get('advisor');
        if (!advisorDef?.execute) return;

        const ctxWithPrompt = withExtraUserMessage(ctx, event.prompt, event.images);

        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);

        try {
            const result = await advisorDef.execute('auto_prompt', {}, ctrl.signal, undefined, ctxWithPrompt);
            const text = resultText(result);
            if (!text) return;

            return {
                message: {
                    role: 'user',
                    content: [{ type: 'text', text }],
                },
            };
        } catch {
            return;
        } finally {
            clearTimeout(t);
        }
    });

    // ── load rpiv-advisor (registers advisor tool, /advisor command, lifecycle hooks) ─
    const { default: rpivAdvisorExtension } = await import('@juicesharp/rpiv-advisor');

    const bridge = createBridge(pi, piMod);
    rpivAdvisorExtension(bridge);
}
