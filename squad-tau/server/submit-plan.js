import { validatePlan } from './validate-plan.js';
import { runOuterReview } from './outer-review.js';

function createSubmitPlanHandler({
    fsm,
    executeDAG,
    ctx,
    pi,
    signal,
    eventBus,
    modelPool,
    onComplete,
    originalTask,
    startTime,
}) {
    return {
        name: 'submit_plan',
        description: 'Submit execution plan with nodes for DAG execution',
        parameters: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: ['M', 'L'],
                    description: 'M = single node, L = multi-node DAG',
                },
                reasoning: {
                    type: 'string',
                    description: 'Reasoning for the plan structure',
                },
                nodes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            task: { type: 'string' },
                            review_criteria: { type: 'string' },
                            depends_on: {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        },
                        required: ['id', 'task', 'review_criteria'],
                    },
                },
            },
            required: ['mode', 'reasoning', 'nodes'],
        },
        handler: async ({ mode, reasoning, nodes }) => {
            const currentState = fsm.getState();
            if (currentState !== 'active' && currentState !== 'revising') {
                throw new Error(`Cannot submit plan in state: ${currentState}. Must be active or revising.`);
            }

            try {
                validatePlan({ mode, reasoning, nodes });
            } catch (error) {
                throw new Error(`Plan validation failed: ${error.message}`);
            }

            if (mode === 'M' && nodes.length !== 1) {
                throw new Error('Mode M requires exactly one node');
            }

            if (mode === 'L' && nodes.length < 2) {
                throw new Error('Mode L requires at least two nodes');
            }

            if (eventBus) {
                eventBus.emit('squad', 'init', {
                    mode,
                    nodes,
                    originalTask: originalTask || '',
                });
            }

            try {
                const results = await executeDAG({
                    nodes,
                    ctx,
                    pi,
                    signal,
                    eventBus,
                    modelPool,
                });

                const nodeResults = results.map((r) => ({
                    id: r.nodeId,
                    status: r.status,
                    summary: r.summary || '',
                    affectedFiles: r.affectedFiles || [],
                }));

                if (mode === 'L') {
                    let outerRound = 1;
                    while (true) {
                        const outerReviewResult = await runOuterReview(
                            nodeResults,
                            originalTask,
                            outerRound,
                            ctx,
                            pi,
                            signal,
                            eventBus,
                            modelPool,
                            startTime,
                        );

                        if (!outerReviewResult) {
                            eventBus.emit('squad', 'abort', { reason: 'Outer review aborted' });
                            return {
                                success: false,
                                message: 'Outer review was aborted.',
                            };
                        }

                        if (outerReviewResult.approved) break;

                        fsm.revise();
                        const feedback = outerReviewResult.feedback || 'Revise and resubmit.';

                        eventBus.emit('squad', 'outer_review_result', {
                            round: outerRound,
                            verdict: 'rejected',
                            feedback,
                        });

                        return {
                            success: true,
                            outerReviewRejected: true,
                            outerRound,
                            feedback,
                            message: `Outer review rejected (round ${outerRound}). Feedback: ${feedback}`,
                        };
                    }
                }

                fsm.deactivate();
                const duration = Date.now() - startTime;
                eventBus.emit('squad', 'complete', { results: nodeResults, durationMs: duration });

                if (onComplete) {
                    onComplete({ results: nodeResults, mode, nodes, durationMs: duration });
                }

                return {
                    success: true,
                    results: nodeResults,
                    message: `Squad completed successfully in ${(duration / 1000).toFixed(1)}s`,
                };
            } catch (error) {
                throw new Error(`DAG execution failed: ${error.message}`);
            }
        },
    };
}

export { createSubmitPlanHandler };
