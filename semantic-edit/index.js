import { getCodingAgentModule, getPiBase } from '@oh-my-pi/resolve-pi';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Value as ValueCheck } from '@sinclair/typebox/value';

const MAX_EMPTY = 30;
const registered = new WeakSet();
const EDIT_TOOL_NAMES = new Set(['edit', 'ast_edit', 'write']);
const AUTO_REPAIR_TOOL_NAMES = new Set(['edit', 'ast_edit']);

const RECOMMENDATION =
    '\n\n💡 For future edits, strongly consider using the `semantic_edit` tool — just describe what you want and it handles the rest.';

let subEditDepth = 0;

function buildReturnEditTool(resolve, state) {
    return {
        name: 'return_edit',
        label: 'Return Edit',
        description: 'Submit your completed edits. You MUST call this tool when done.',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['ok', 'error'], description: 'ok = success, error = failure' },
                summary: { type: 'string', description: 'Brief summary of changes made' },
                affected_files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Files modified or created',
                },
                reason: { type: 'string' },
            },
            required: ['status', 'summary'],
        },
        async execute(_id, params, _sig, _upd, childCtx) {
            state.settled = true;
            resolve(params);
            childCtx?.abort?.();
            return { content: [], display: false };
        },
    };
}

function buildSessionOptions(ctx) {
    const options = {
        cwd: ctx?.cwd ?? process.cwd(),
        hasUI: false,
        toolNames: ['read', 'edit', 'write', 'find', 'search', 'bash', 'lsp'],
    };
    if (ctx?.modelRegistry) options.modelRegistry = ctx.modelRegistry;
    if (ctx?.model) options.model = ctx.model;
    if (ctx?.agentsMdSearch) options.agentsMdSearch = ctx.agentsMdSearch;
    if (ctx?.workspaceTree) options.workspaceTree = ctx.workspaceTree;
    if (ctx?.getThinkingLevel) options.thinkingLevel = ctx.getThinkingLevel();
    if (ctx?.getSystemPrompt) options.systemPrompt = ctx.getSystemPrompt();
    return options;
}

async function runEditSession(pi, intent, signal, ctx) {
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) throw new Error('semantic-edit: createAgentSession unavailable');

    const { SessionManager } = await getCodingAgentModule();
    const childAbort = new AbortController();
    if (signal) signal.addEventListener('abort', () => childAbort.abort(), { once: true });

    let unsubInput = null;
    if (typeof ctx?.ui?.onTerminalInput === 'function') {
        unsubInput = ctx.ui.onTerminalInput((data) => {
            if (data === 'escape' || data === 'esc' || data === 'ctrl+c' || data === 'ctrl+d') {
                childAbort.abort();
                return { consume: true };
            }
            return undefined;
        });
    }

    const { promise: resultPromise, resolve } = Promise.withResolvers();
    const state = { settled: false };
    const returnEditTool = buildReturnEditTool(resolve, state);
    const options = buildSessionOptions(ctx);

    const factoryResult = await createAgentSession({
        ...options,
        sessionManager: SessionManager.create(options.cwd),
        customTools: [returnEditTool],
    });
    const session = factoryResult.session;

    let empty = 0;
    subEditDepth++;
    try {
        await session.prompt(
            `You are an autonomous code editor. Perform the following edit based on the user's intent.\n\n` +
                `Intent: ${intent}\n\n` +
                `Instructions:\n` +
                `1. Use 'search' and 'find' to locate relevant files\n` +
                `2. Use 'read' to inspect the files\n` +
                `3. Use 'edit' or 'write' to make changes (preserve existing conventions)\n` +
                `4. Use 'lsp' to verify types and references after editing\n` +
                `5. Call return_edit({ status: "ok", summary: "...", affected_files: [...] }) when all changes are complete\n` +
                `6. NEVER output prose when you mean to return — call the tool directly`,
        );

        while (!state.settled && empty < MAX_EMPTY && !childAbort.signal.aborted) {
            await session.waitForIdle();
            if (state.settled || childAbort.signal.aborted) break;
            empty++;
            if (empty >= MAX_EMPTY)
                throw new Error(`Edit session ended without calling return_edit after ${MAX_EMPTY} empty turns`);
            await session.prompt('ERROR: You must call return_edit to finish. Do not output prose — call the tool.');
        }

        if (!state.settled && !childAbort.signal.aborted)
            throw new Error(`Edit session ended without calling return_edit after ${empty} empty turns`);
        return await resultPromise;
    } catch (err) {
        session?.abort?.();
        throw err;
    } finally {
        subEditDepth--;
        childAbort.abort();
        session?.abort?.();
        factoryResult?.dispose?.();
        unsubInput?.();
    }
}

function paramsToIntent(params) {
    if (params.path && params.ops) {
        const ops = params.ops.map((op) => `\n  pat: \`${op.pat}\`\n  → \`${op.out}\``).join('');
        return `In files matching "${params.paths.join('", "')}":${ops}`;
    }
    const file = params.path || params.file;
    if (params.old_text != null) {
        return `Edit "${file}":\n\nFIND:\n${params.old_text}\n\nREPLACE WITH:\n${params.new_text}`;
    }
    if (params.content?.trim()) {
        return `Write to "${file}":\n\n\`\`\`\n${params.content}\n\`\`\``;
    }
    return JSON.stringify(params);
}

function extractErrorText(content) {
    const block = Array.isArray(content) ? content.find((c) => c.type === 'text') : undefined;
    return block?.text || 'Edit failed';
}

function hasRecommendation(text) {
    return typeof text === 'string' && text.includes('`semantic_edit`');
}

function appendRecommendation(content) {
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: '' }];
    const result = [];
    let added = false;
    for (const block of blocks) {
        if (!added && block.type === 'text' && typeof block.text === 'string') {
            if (hasRecommendation(block.text)) {
                result.push(block);
            } else {
                result.push({ ...block, text: block.text + RECOMMENDATION });
            }
            added = true;
        } else {
            result.push(block);
        }
    }
    if (!added) result.push({ type: 'text', text: RECOMMENDATION.trimStart() });
    return result;
}

// ── Schema validation ────────────────────────────────────────────────────

let schemaCache = null;

async function getToolSchemas() {
    if (schemaCache) return schemaCache;
    const PI_BASE = getPiBase();
    const baseUrl = pathToFileURL(join(PI_BASE, 'pi-coding-agent/src')).href + '/';

    const settingsStub = {
        get(key) {
            const map = {
                'edit.mode': 'replace',
                'edit.fuzzyMatch': true,
                'edit.fuzzyThreshold': 0.8,
                'lsp.formatOnWrite': false,
                'lsp.diagnosticsOnEdit': false,
                'lsp.diagnosticsOnWrite': false,
                'edit.updateMode': 'replace',
            };
            return map[key];
        },
        getEditVariantForModel: () => null,
    };
    const sessionStub = {
        cwd: process.cwd(),
        hasUI: false,
        enableLsp: false,
        settings: settingsStub,
        getSessionFile: () => null,
        getSessionSpawns: () => null,
        getActiveModelString: () => undefined,
    };

    let edit, write, astEdit;
    try {
        const editMod = await import(baseUrl + 'edit/index.ts');
        edit = new editMod.EditTool(sessionStub).parameters;
    } catch {
        edit = null;
    }
    try {
        const writeMod = await import(baseUrl + 'tools/write.ts');
        write = new writeMod.WriteTool(sessionStub).parameters;
    } catch {
        write = null;
    }
    try {
        const astMod = await import(baseUrl + 'tools/ast-edit.ts');
        astEdit = new astMod.AstEditTool(sessionStub).parameters;
    } catch {
        astEdit = null;
    }

    schemaCache = { edit, write, ast_edit: astEdit };
    return schemaCache;
}

function formatSchemaErrors(errors) {
    const msgs = [];
    for (const err of errors) {
        msgs.push(`${err.path}: ${err.message}`);
        if (msgs.length >= 3) break;
    }
    return msgs.join('; ');
}

// ── Plugin ───────────────────────────────────────────────────────────────

export default async function semanticEditExtension(pi) {
    if (registered.has(pi)) return;
    registered.add(pi);

    const pendingRepairs = new Set();

    pi.on('tool_call', async (evt, ctx) => {
        if (subEditDepth > 0) return;
        const toolName = evt.toolName;
        if (!EDIT_TOOL_NAMES.has(toolName)) return;

        if (!evt.input || typeof evt.input !== 'object') return;

        try {
            const schemas = await getToolSchemas();
            const schema = schemas[toolName];
            if (!schema) return;

            if (!ValueCheck.Check(schema, evt.input)) {
                const errors = ValueCheck.Errors(schema, evt.input);
                const formatted = formatSchemaErrors(errors);
                return {
                    block: true,
                    reason: [
                        `Invalid parameters for "${toolName}": ${formatted}`,
                        '',
                        `💡 Use the \`semantic_edit\` tool instead — just describe your intent and let it handle the details.`,
                    ].join('\n'),
                };
            }
        } catch {
            // schema validation unavailable — allow call through
        }
    });

    pi.on('tool_result', async (evt, ctx) => {
        if (subEditDepth > 0) return;
        const toolName = evt.toolName;
        if (!EDIT_TOOL_NAMES.has(toolName)) return;

        // ── Success: append recommendation ──
        if (!evt.isError) {
            if (Array.isArray(evt.content) && evt.content.some((b) => b.type === 'text' && hasRecommendation(b.text))) {
                return undefined;
            }
            return { content: appendRecommendation(evt.content) };
        }

        // ── Failure: auto-repair for edit/ast_edit ──
        if (AUTO_REPAIR_TOOL_NAMES.has(toolName)) {
            const params = evt.input;
            const dedupeKey = toolName + '_' + JSON.stringify(params).slice(0, 100);
            if (!params || pendingRepairs.has(dedupeKey)) return undefined;
            pendingRepairs.add(dedupeKey);

            try {
                const errorText = extractErrorText(evt.content);
                const intent = `Auto-repair failed edit: ${errorText}\n\nContext: ${paramsToIntent(params)}`;
                const result = await runEditSession(pi, intent, null, ctx);
                if (result.status === 'ok') {
                    const files = result.affected_files?.join(', ') || '(unknown)';
                    return {
                        isError: false,
                        content: [
                            {
                                type: 'text',
                                text: `The previous edit attempt failed, but it has been automatically recovered via semantic-edit. Changes applied to: ${files}. Summary: ${result.summary}.${RECOMMENDATION}`,
                            },
                        ],
                    };
                }
                return {
                    isError: false,
                    content: [
                        {
                            type: 'text',
                            text: `The previous edit could not be auto-repaired: ${result.reason || result.summary}.${RECOMMENDATION}`,
                        },
                    ],
                };
            } catch (err) {
                return {
                    isError: false,
                    content: [
                        {
                            type: 'text',
                            text: `The previous edit could not be auto-repaired: ${err.message}.${RECOMMENDATION}`,
                        },
                    ],
                };
            }
        }

        // ── Failure for other edit tools (write): clear error + recommend ──
        if (Array.isArray(evt.content) && evt.content.some((b) => b.type === 'text' && hasRecommendation(b.text))) {
            return undefined;
        }
        return { isError: false, content: appendRecommendation(evt.content) };
    });

    pi.registerTool({
        name: 'semantic_edit',
        label: 'Semantic Edit',
        description:
            'Edit code by describing intent. Reads, edits, and verifies files automatically in a subagent session.',
        parameters: {
            type: 'object',
            properties: {
                intent: { type: 'string', description: 'Description of the edit you want to perform' },
            },
            required: ['intent'],
        },
        async execute(_id, params, signal, _upd, ctx) {
            if (!params.intent?.trim()) throw new Error('intent is required');

            const result = await runEditSession(pi, params.intent.trim(), signal, ctx);
            const text = [
                `Status: ${result.status || ''}`,
                `Summary: ${result.summary || ''}`,
                ...(result.affected_files?.length ? [`Files: ${result.affected_files.join(', ')}`] : []),
            ].join('\n');

            return {
                content: [{ type: 'text', text }],
                details: { ...result },
            };
        },
    });
}
