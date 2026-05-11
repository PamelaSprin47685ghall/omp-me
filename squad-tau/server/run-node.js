import { runWorker } from './run-worker.js';
import { runReviewer } from './run-reviewer.js';
import { STATUS } from './constants.js';

async function runWorkerPhase(args) {
    const { node, eventBus, modelPool, signal } = args;
    eventBus.emit('squad', 'node_state', {
        nodeId: node.id,
        status: STATUS.AUTHORING,
        retryCount: args.retryCount,
        timestamp: Date.now(),
    });

    const workerSlot = await modelPool.acquire('worker', signal);
    try {
        const result = await runWorker({ ...args, modelSlot: workerSlot });
        if (!result) throw new Error('Worker returned null');
        return result;
    } finally {
        modelPool.release(workerSlot);
    }
}

async function runReviewerPhase(args, workerResult) {
    const { node, eventBus, modelPool, signal } = args;
    eventBus.emit('squad', 'node_state', { nodeId: node.nodeId, status: STATUS.CONFIRMING, timestamp: Date.now() });
    eventBus.emit('squad', 'node_state', { nodeId: node.nodeId, status: STATUS.REVIEWING, timestamp: Date.now() });

    const reviewerSlot = await modelPool.acquire('reviewer', signal);
    try {
        const result = await runReviewer({ ...args, workerResult, modelSlot: reviewerSlot });
        if (!result) throw new Error('Reviewer returned null');
        return result;
    } finally {
        modelPool.release(reviewerSlot);
    }
}

async function runNode(args) {
    const { node, eventBus } = args;
    let reviewerFeedback = null;
    let retryCount = 0;
    const iterationHistory = [];

    try {
        while (true) {
            const workerResult = await runWorkerPhase({ ...args, reviewerFeedback, retryCount, iterationHistory });
            const reviewResult = await runReviewerPhase({ ...args, iterationHistory }, workerResult);

            if (reviewResult.approved) {
                eventBus.emit('squad', 'node_state', {
                    nodeId: node.id,
                    status: STATUS.APPROVED,
                    timestamp: Date.now(),
                });
                return {
                    nodeId: node.id,
                    status: STATUS.APPROVED,
                    summary: workerResult.reason,
                    affectedFiles: workerResult.affected_files,
                };
            }

            retryCount++;
            iterationHistory.push({
                workRecord: { reason: workerResult.reason, affected_files: workerResult.affected_files },
                feedback: reviewResult.reason,
            });
            reviewerFeedback = reviewResult.reason;
            eventBus.emit('squad', 'node_state', {
                nodeId: node.id,
                status: STATUS.REJECTED,
                retryCount,
                timestamp: Date.now(),
            });
        }
    } catch (error) {
        eventBus.emit('squad', 'node_state', {
            nodeId: node.id,
            status: STATUS.FAILED,
            error: error.message,
            timestamp: Date.now(),
        });
        throw error;
    }
}

export { runNode };
