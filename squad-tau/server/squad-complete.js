import { runOuterReview } from './outer-review.js';

export function createOnCompleteHandler({ task, ctx, pi, signal, eventBus, modelPool, fsm, startTime }) {
    return async ({ results, mode }) => {
        const nodeResults = results.map((r) => ({
            id: r.nodeId,
            status: r.status,
            summary: r.summary || '',
            affectedFiles: r.affectedFiles || [],
        }));

        if (mode === 'L') {
            const outerReviewResult = await runOuterReview(
                nodeResults,
                task,
                1,
                ctx,
                pi,
                signal,
                eventBus,
                modelPool,
                startTime,
            );

            if (!outerReviewResult || outerReviewResult.approved === false) {
                if (!outerReviewResult) {
                    ctx.sendMessage('Outer review aborted.');
                } else {
                    fsm.revise();
                    ctx.sendMessage('Outer review rejected (round 1). Please revise and resubmit.');
                    if (outerReviewResult.feedback) {
                        ctx.sendMessage(`Feedback: ${outerReviewResult.feedback}`);
                    }
                }
                return;
            }
        }

        fsm.deactivate();
        const duration = Date.now() - startTime;
        eventBus.emit('squad', 'complete', { results: nodeResults, durationMs: duration });
        ctx.sendMessage(`Squad completed successfully in ${(duration / 1000).toFixed(1)}s`);
    };
}
