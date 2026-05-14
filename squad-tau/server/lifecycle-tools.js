import { getReturnResolver } from './session-registry.js';
import { getCurrentRun } from './plugin-state.js';
import { processDelegate } from './submit-plan.js';

/**
 * Link an OMP tool abort signal to the run's abortController.
 * Called inside delegateTool.execute so that when the parent session
 * is stopped, the entire DAG cascade cancels (not just the architect).
 */
function linkOmpSignal(run, sig) {
    if (!sig) return;
    if (sig.aborted) {
        run.abortController.abort();
        return;
    }
    sig.addEventListener('abort', () => run.abortController.abort(), { once: true });
}

export const returnTool = {
    name: 'return',
    label: 'Return',
    description: 'Return result from current phase. You MUST call this tool to finish.',
    parameters: {
        type: 'object',
        properties: {
            status: {
                type: 'string',
                enum: ['ok', 'error'],
                description: 'ok = success/approve, error = failure/reject',
            },
            reason: { type: 'string', description: 'Summary or feedback' },
            affected_files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files modified or created',
            },
        },
        required: ['status', 'reason'],
    },
    async execute(_id, params, _sig, _upd, ctx) {
        const sessionFile = ctx?.sessionManager?.getSessionFile?.();
        const resolver = sessionFile ? getReturnResolver(sessionFile) : null;
        if (!resolver) {
            // Outside squad context — just acknowledge receipt.
            return { content: [{ type: 'text', text: 'return received' }], display: false };
        }
        resolver(params);
        ctx?.abort?.();
        return { content: [], display: false };
    },
};

export const delegateTool = {
    name: 'delegate',
    label: 'Delegate',
    description: 'Delegate execution by reading plan nodes from a directory of .toml files',
    parameters: {
        type: 'object',
        properties: {
            plan_dir: { type: 'string', description: 'Directory containing .toml node definition files' },
        },
        required: ['plan_dir'],
    },
    async execute(_id, params, sig, _upd, _ctx) {
        const run = getCurrentRun();
        if (!run) throw new Error('No active squad run');
        linkOmpSignal(run, sig);
        if (sig?.aborted) {
            return { content: [{ type: 'text', text: 'Squad aborted by user.' }], display: false };
        }
        const result = await processDelegate(params, run);
        return { content: [{ type: 'text', text: result.message || 'Delegated' }], display: false };
    },
};
