import { runWorker } from './run-worker.js';
import { runReviewer } from './run-reviewer.js';
import { STATUS, DEFAULTS } from './constants.js';

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
    eventBus.emit('squad', 'node_state', { nodeId: node.id, status: STATUS.CONFIRMING, timestamp: Date.now() });
    eventBus.emit('squad', 'node_state', { nodeId: node.id, status: STATUS.REVIEWING, timestamp: Date.now() });

    const reviewerSlot = await modelPool.acquire('reviewer', signal);
    try {
        const result = await runReviewer({ ...args, workerResult, modelSlot: reviewerSlot });
        if (!result) throw new Error('Reviewer returned null');
        return result;
    } finally {
        modelPool.release(reviewerSlot);
    }
}

function buildApprovedResult(node, workerResult) {
    return {
        nodeId: node.id,
        status: STATUS.APPROVED,
        summary: workerResult.reason,
        affectedFiles: workerResult.affected_files,
    };
}

function emitApproved(eventBus, node) {
    eventBus.emit('squad', 'node_state', {
        nodeId: node.id,
        status: STATUS.APPROVED,
        timestamp: Date.now(),
    });
}

function buildIterationEntry(workerResult, reviewResult) {
    return {
        workRecord: { reason: workerResult.reason, affected_files: workerResult.affected_files },
        feedback: reviewResult.reason,
    };
}

function emitRejected(eventBus, node, retryCount) {
    eventBus.emit('squad', 'node_state', {
        nodeId: node.id,
        status: STATUS.REJECTED,
        retryCount,
        timestamp: Date.now(),
    });
}

function executeRetryLoop(node, eventBus, args) {
    const maxRetries = DEFAULTS.MAX_RETRIES;
    let reviewerFeedback = null;
    let retryCount = 0;
    const iterationHistory = [];

    return (async function runIteration() {
        while (true) {
            const workerResult = await runWorkerPhase({ ...args, reviewerFeedback, retryCount, iterationHistory });
            const reviewResult = await runReviewerPhase({ ...args, iterationHistory }, workerResult);

            if (reviewResult.approved) {
                emitApproved(eventBus, node);
                return buildApprovedResult(node, workerResult);
            }

            retryCount++;
            if (retryCount >= maxRetries) {
                throw new Error(
                    `Max retries (${maxRetries}) exceeded for node ${node.id}. Last feedback: ${reviewResult.reason}`,
                );
            }
            iterationHistory.push(buildIterationEntry(workerResult, reviewResult));
            reviewerFeedback = reviewResult.reason;
            emitRejected(eventBus, node, retryCount);
        }
    })();
}

function emitFailed(eventBus, node, error) {
    eventBus.emit('squad', 'node_state', {
        nodeId: node.id,
        status: STATUS.FAILED,
        error: error.message,
        timestamp: Date.now(),
    });
}

async function runNode(args) {
    const { node, eventBus } = args;
    try {
        return await executeRetryLoop(node, eventBus, args);
    } catch (error) {
        emitFailed(eventBus, node, error);
        throw error;
    }
}

export { runNode };
