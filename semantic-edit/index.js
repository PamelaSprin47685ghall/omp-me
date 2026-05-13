import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';

const MAX_EMPTY = 30;
const registered = new WeakSet();

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
                affected_files: { type: 'array', items: { type: 'string' }, description: 'Files modified or created' },
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

function buildSessionOptions(ctx, pi) {
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

    const { promise: resultPromise, resolve } = Promise.withResolvers();
    const state = { settled: false };
    const returnEditTool = buildReturnEditTool(resolve, state);

    const options = buildSessionOptions(ctx, pi);
    const sessionOpts = {
        ...options,
        sessionManager: SessionManager.create(options.cwd),
        customTools: [returnEditTool],
    };

    const factoryResult = await createAgentSession(sessionOpts);
    const session = factoryResult.session;

    let empty = 0;
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
        childAbort.abort();
        session?.abort?.();
        factoryResult?.dispose?.();
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

const RECOMMENDATION =
    '\n\n💡 For future edits, strongly consider using the `semantic_edit` tool — just describe what you want and it handles the rest.';

export default async function semanticEditExtension(pi) {
    if (registered.has(pi)) return;
    registered.add(pi);

    const sessionFiles = new Set();

    pi.on('session_start', (_evt, ctx) => {
        const sf = ctx?.sessionManager?.getSessionFile?.();
        if (sf) sessionFiles.add(sf);
    });

    const pendingRepairs = new Set();

    pi.on('tool_execution_end', async (evt, ctx) => {
        const toolName = evt?.toolName;
        if (toolName !== 'edit' && toolName !== 'ast_edit') return;
        if (!evt?.result?.isError) return;

        const sf = ctx?.sessionManager?.getSessionFile?.();
        if (sf && !sessionFiles.has(sf)) return;

        const params = evt?.input;
        if (!params) return;
        if (pendingRepairs.has(toolName + '_' + JSON.stringify(params).slice(0, 100))) return;

        const errorText = evt?.result?.content?.find((c) => c.type === 'text')?.text || evt?.error || 'Edit failed';
        pendingRepairs.add(toolName + '_' + JSON.stringify(params).slice(0, 100));

        const intent = paramsToIntent(params);

        try {
            const result = await runEditSession(
                pi,
                `Auto-repair failed edit: ${errorText}\n\nContext: ${intent}`,
                null,
                ctx,
            );
            if (result.status === 'ok') {
                const files = result.affected_files?.join(', ') || '(unknown)';
                pi.sendUserMessage(
                    `The previous edit attempt failed, but it has been automatically recovered via semantic-edit. Changes applied to: ${files}. Summary: ${result.summary}`,
                    { deliverAs: 'steer' },
                );
            } else {
                pi.sendUserMessage(
                    `The previous edit also failed to auto-recover: ${result.reason || result.summary}`,
                    { deliverAs: 'steer' },
                );
            }
        } catch (err) {
            pi.sendUserMessage(`The previous edit could not be automatically recovered: ${err.message}`, {
                deliverAs: 'steer',
            });
        }
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

            const includeRecommendation = !ctx?._semanticEditNoRecommend;
            const finalText = includeRecommendation ? text + RECOMMENDATION : text;

            return {
                content: [{ type: 'text', text: finalText }],
                details: { ...result },
            };
        },
    });
}
