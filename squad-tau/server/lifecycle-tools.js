/**
 * OMP tool definitions for squad-tau.
 *
 * Role-specific tools matching each phase:
 * - Workers (authoring/confirming): `return` — submit work for review
 * - Reviewers (reviewing/outer_review): `approve` / `reject` — decide on submitted work
 *
 * Tool names are semantically locked to roles to prevent LLM role-confusion.
 * buildSessionOptions in side-effects.js injects the correct tool set per phase.
 */
export const returnTool = {
    name: 'return',
    label: 'Return',
    description: 'Submit your completed work. You MUST call this tool to finish your task.',
    parameters: {
        type: 'object',
        properties: {
            status: {
                type: 'string',
                enum: ['ok'],
                description: 'ok = work completed',
            },
            reason: { type: 'string', description: 'Summary of what was done' },
            affected_files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files modified or created',
            },
        },
        required: ['status', 'reason'],
    },
    async execute(_id, _params, _sig, _upd, ctx) {
        ctx?.abort?.();
        return { content: [], display: false };
    },
};

export const acceptTool = {
    name: 'accept',
    label: 'Accept',
    description: 'Accept the submitted work. Call this when the work meets all review criteria.',
    parameters: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description: 'Acceptance summary — what passed and why',
            },
            affected_files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files reviewed (optional)',
            },
        },
        required: ['reason'],
    },
    async execute(_id, _params, _sig, _upd, ctx) {
        ctx?.abort?.();
        return { content: [], display: false };
    },
};

export const rejectTool = {
    name: 'reject',
    label: 'Reject',
    description: 'Reject the submitted work with detailed feedback. Call this when the work fails review criteria.',
    parameters: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description: 'Detailed rejection feedback — what failed and what to improve',
            },
            affected_files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files that need changes (optional)',
            },
        },
        required: ['reason'],
    },
    async execute(_id, _params, _sig, _upd, ctx) {
        ctx?.abort?.();
        return { content: [], display: false };
    },
};
