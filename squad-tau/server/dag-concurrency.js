import { STATUS, DEFAULTS } from './constants.js';
import { runNode } from './run-node.js';

async function executeLayer(nodes, ctx, pi, signal, eventBus, modelPool) {
    const concurrency = ctx.concurrency || DEFAULTS.FALLBACK_CONCURRENCY;
    const results = [];
    const queue = [...nodes];
    const running = new Set();

    await processQueue({ queue, running, results, concurrency, ctx, pi, signal, eventBus, modelPool });

    return results;
}

async function processQueue(state) {
    const { queue, running, results, concurrency } = state;
    while (queue.length > 0 || running.size > 0) {
        while (running.size < concurrency && queue.length > 0) {
            const node = queue.shift();
            const promise = executeOne(node, state).then((result) => {
                running.delete(promise);
                results.push(result);
                return result;
            });
            running.add(promise);
        }

        if (running.size > 0) {
            await Promise.race(running);
        }
    }
}

async function executeOne(node, { signal, eventBus, ctx, pi, modelPool }) {
    if (signal.aborted) {
        return { nodeId: node.id, status: STATUS.FAILED, summary: 'Aborted', affectedFiles: [] };
    }

    try {
        const result = await runNode({
            node,
            upstreamResults: ctx.upstreamResults || [],
            ctx,
            pi,
            signal,
            eventBus,
            modelPool,
        });

        return {
            nodeId: node.id,
            status: result.status,
            summary: result.summary || '',
            affectedFiles: result.affectedFiles || [],
        };
    } catch (error) {
        if (signal.aborted) {
            return { nodeId: node.id, status: STATUS.FAILED, summary: 'Aborted by signal', affectedFiles: [] };
        }
        return { nodeId: node.id, status: STATUS.FAILED, summary: error.message, affectedFiles: [] };
    }
}

export { executeLayer };
