import fs from 'node:fs/promises';
import path from 'node:path';

const EDITOR_PROMPT = [
    'You are a code editing assistant.',
    'Implement the requested code changes in the workspace.',
    'Use read, edit, write, find, fuzzy_find, fuzzy_grep, and lsp as needed.',
    'Do not use bash unless the user explicitly requires it.',
].join(' ');

const GREPER_PROMPT = [
    'You are a code exploration agent.',
    'Use find, fuzzy_find, fuzzy_grep, and read to locate relevant code.',
    'Summarize what you found with concrete file references.',
].join(' ');

const REVERIE_PROMPT = [
    'You are in a quiet room with the texts and the question.',
    'Read carefully and answer with clarity and depth.',
].join(' ');

const BROWSER_PROMPT = [
    'You are a browser automation agent.',
    'Use available browser tools to execute the described web task step by step.',
].join(' ');

export const SUBAGENT_TOOL_NAMES = ['editor', 'greper', 'reverie', 'browse'];

export function registerSubagentTools(pi, helpers) {
    const { runSubagent } = helpers;

    pi.registerTool({
        name: 'editor',
        label: 'Editor',
        description: 'Delegate code changes to a focused editing subagent.',
        parameters: pi.typebox.Object({
            intent: pi.typebox.String({ description: 'Describe the desired code changes with full context.' }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            return {
                content: [{
                    type: 'text',
                    text: await runSubagent(pi, ctx, {
                        toolNames: ['read', 'edit', 'write', 'find', 'fuzzy_find', 'fuzzy_grep', 'lsp'],
                        prompt: `${EDITOR_PROMPT}\n\n${params.intent}`,
                    }),
                }],
            };
        },
    });

    pi.registerTool({
        name: 'greper',
        label: 'Greper',
        description: 'Delegate codebase exploration to a focused search subagent.',
        parameters: pi.typebox.Object({
            intent: pi.typebox.String({ description: 'Describe what code or files to find with full context.' }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            return {
                content: [{
                    type: 'text',
                    text: await runSubagent(pi, ctx, {
                        toolNames: ['read', 'find', 'fuzzy_find', 'fuzzy_grep'],
                        prompt: `${GREPER_PROMPT}\n\n${params.intent}`,
                    }),
                }],
            };
        },
    });

    pi.registerTool({
        name: 'reverie',
        label: 'Reverie',
        description: 'Delegate deep reasoning with explicit file context.',
        parameters: pi.typebox.Object({
            intent: pi.typebox.String({ description: 'Question or reasoning task.' }),
            files: pi.typebox.Array(pi.typebox.String({ description: 'File path to include as context.' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const parts = await Promise.all((params.files || []).map(async (file) => {
                const fullPath = path.resolve(ctx.cwd, file);
                try {
                    return `=== ${file} ===\n\n${await fs.readFile(fullPath, 'utf-8')}`;
                } catch {
                    return `=== ${file} ===\n\n(unable to read)`;
                }
            }));
            parts.push(`Question:\n${params.intent}`);
            return {
                content: [{
                    type: 'text',
                    text: await runSubagent(pi, ctx, {
                        toolNames: [],
                        prompt: `${REVERIE_PROMPT}\n\n${parts.join('\n\n')}`,
                    }),
                }],
            };
        },
    });

    pi.registerTool({
        name: 'browse',
        label: 'Browse',
        description: 'Delegate browser tasks to a focused subagent using only the built-in browser tool.',
        parameters: pi.typebox.Object({
            intent: pi.typebox.String({ description: 'Describe the web task with full context.' }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            if (!pi.getAllTools().includes('browser')) {
                return { content: [{ type: 'text', text: 'Built-in browser tool is unavailable in this session.' }], isError: true };
            }
            return {
                content: [{
                    type: 'text',
                    text: await runSubagent(pi, ctx, {
                        toolNames: ['browser'],
                        prompt: `${BROWSER_PROMPT}\n\n${params.intent}`,
                    }),
                }],
            };
        },
    });
}
