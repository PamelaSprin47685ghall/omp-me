/**
 * OMP tool definitions for squad-tau.
 *
 * In the new event-sourced architecture, tool calls are captured by
 * session-events.js → EventLog directly. These execute functions are
 * clean no-ops that only call ctx.abort() — no context lookup, no
 * run resolution, no Promise tracking.
 */
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
            affected_files: { type: 'array', items: { type: 'string' }, description: 'Files modified or created' },
        },
        required: ['status', 'reason'],
    },
    async execute(_id, _params, _sig, _upd, ctx) {
        ctx?.abort?.();
        return { content: [], display: false };
    },
};
