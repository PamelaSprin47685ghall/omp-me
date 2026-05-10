/**
 * Self-confirm lifecycle tools: confirm() and return_work().
 * Splitting from run-confirm.js to keep each file ≤200 lines.
 */

function buildConfirmTools(outcomeResolve, setSettled) {
    const confirmTool = {
        name: 'confirm',
        label: 'Confirm Submission',
        description: 'Confirm your work passes self-review. Only call after verifying all dimensions.',
        parameters: {
            type: 'object',
            properties: {
                comment: { type: 'string', description: 'Optional confirmation note' },
            },
        },
        async execute(_id, params, _sig, _upd, childCtx) {
            setSettled(true);
            outcomeResolve({ approved: true, comment: params?.comment || null });
            childCtx?.abort?.();
            return { content: [], display: false };
        },
    };

    const returnWorkTool = {
        name: 'return_work',
        label: 'Return Work',
        description: 'Submit completed work. You MUST call this tool to finish.',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Concise description of what you accomplished' },
                affected_files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Every file you created or modified',
                },
            },
            required: ['summary', 'affected_files'],
        },
        async execute(_id, params, _sig, _upd, childCtx) {
            setSettled(true);
            outcomeResolve({
                type: 'return_work',
                summary: params.summary,
                affected_files: params.affected_files || [],
            });
            childCtx?.abort?.();
            return { content: [], display: false };
        },
    };

    return [confirmTool, returnWorkTool];
}

function emitSessionEnd(eventBus, sessionId, phase, reason, errorMessage) {
    if (!eventBus || !sessionId) return;
    eventBus.emit('session', 'state', { sessionId, phase });
    eventBus.emit('session', 'end', { sessionId, reason, errorMessage });
}

export { buildConfirmTools, emitSessionEnd };
