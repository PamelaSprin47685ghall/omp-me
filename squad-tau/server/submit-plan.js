import { validatePlan } from './validate-plan.js';

function createSubmitPlanHandler({ fsm, executeDAG, ctx, pi, signal, eventBus, modelPool, onComplete, originalTask }) {
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

                if (onComplete) {
                    await onComplete({ results, mode, nodes });
                }

                return {
                    success: true,
                    results,
                    message: `Executed ${results.length} node(s)`,
                };
            } catch (error) {
                throw new Error(`DAG execution failed: ${error.message}`);
            }
        },
    };
}

export { createSubmitPlanHandler };
