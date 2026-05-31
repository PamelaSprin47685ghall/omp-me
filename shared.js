export function getSessionIdFromContext(ctx) {
    return ctx?.sessionManager?.getSessionId?.() || ctx?.sessionManager?.sessionId || null;
}

export function asErrorResult(error) {
    return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
    };
}

export function stringArraySchema(pi, description) {
    return pi.typebox.Array(pi.typebox.String({ description }));
}
