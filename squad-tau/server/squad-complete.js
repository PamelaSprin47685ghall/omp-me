export function createOnCompleteHandler({ ctx, fsm, eventBus }) {
    return ({ results, mode, nodes, durationMs }) => {
        const nodeResults = results.map((r) => ({
            id: r.id || r.nodeId,
            status: r.status,
            summary: r.summary || '',
            affectedFiles: r.affectedFiles || [],
        }));

        if (eventBus) {
            eventBus.emit('squad', 'complete', { results: nodeResults, durationMs });
        }

        fsm.deactivate();
        ctx.sendMessage(`Squad completed successfully in ${(durationMs / 1000).toFixed(1)}s`);
    };
}
