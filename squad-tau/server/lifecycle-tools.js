import { getReturnResolver } from './session-registry.js';
import { getCurrentRun } from './plugin-state.js';
import { processDelegate } from './submit-plan.js';

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
        if (!sessionFile) {
            throw new Error('sessionFile is required but not found in context');
        }
        const resolver = getReturnResolver(sessionFile);
        if (!resolver) {
            throw new Error(`No return resolver found for session ${sessionFile}`);
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
    async execute(_id, params, _sig, _upd, _ctx) {
        const run = getCurrentRun();
        if (!run) throw new Error('No active squad run');
        const result = await processDelegate(params, run);
        return { content: [{ type: 'text', text: result.message || 'Delegated' }], display: false };
    },
};
