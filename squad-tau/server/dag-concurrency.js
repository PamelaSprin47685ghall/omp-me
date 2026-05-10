import { STATUS } from './constants.js';
import { runNode } from './run-node.js';

async function executeLayer(nodes, ctx, pi, signal, eventBus, modelPool) {
    const concurrency = ctx.concurrency || 5;
    const results = [];
    const queue = [...nodes];
    const running = new Set();

    async function executeOne(node) {
        if (signal.aborted) {
            return {
                nodeId: node.id,
                status: STATUS.FAILED,
                summary: 'Aborted',
                affectedFiles: [],
            };
        }

        eventBus.emit('squad:node_start', { nodeId: node.id });

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

            eventBus.emit('squad:node_end', { nodeId: node.id, status: result.status });

            return {
                nodeId: node.id,
                status: result.status,
                summary: result.summary || '',
                affectedFiles: result.affectedFiles || [],
            };
        } catch (error) {
            eventBus.emit('squad:node_end', { nodeId: node.id, status: STATUS.FAILED, error: error.message });

            return {
                nodeId: node.id,
                status: STATUS.FAILED,
                summary: error.message,
                affectedFiles: [],
            };
        }
    }

    async function processQueue() {
        while (queue.length > 0 || running.size > 0) {
            while (running.size < concurrency && queue.length > 0) {
                const node = queue.shift();
                const promise = executeOne(node).then((result) => {
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

    await processQueue();

    return results;
}

export { executeLayer };
