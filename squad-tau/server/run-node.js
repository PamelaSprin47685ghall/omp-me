import { runWorker } from './run-worker.js';
import { runConfirmSession } from './run-confirm.js';
import { runReviewer } from './run-reviewer.js';
import { captureFileSnapshots } from './tamper-detection.js';
import { STATUS, EVENT } from './constants.js';

async function runNode({ node, upstreamResults, ctx, pi, signal, eventBus, modelPool }) {
    const { nodeId } = node;
    let reviewerFeedback = null;
    let workerSlot = null;
    let reviewerSlot = null;
    let retryCount = 0;

    try {
        while (true) {
            eventBus.emit('squad', 'node_state', {
                nodeId,
                status: STATUS.AUTHORING,
                retryCount,
                timestamp: Date.now(),
            });

            workerSlot = await modelPool.acquire('worker', signal);

            const workerResult = await runWorker({
                node,
                upstreamResults,
                reviewerFeedback,
                ctx,
                pi,
                signal,
                eventBus,
                modelSlot: workerSlot,
            });

            modelPool.release(workerSlot);
            workerSlot = null;

            if (!workerResult) {
                throw new Error('Worker returned null');
            }

            eventBus.emit('squad', 'node_state', {
                nodeId,
                status: STATUS.CONFIRMING,
                timestamp: Date.now(),
            });

            let finalWorkerResult = workerResult;

            while (true) {
                const confirmResult = await runConfirmSession({
                    pi,
                    sessionId: workerResult.sessionFile,
                    workerOptions: {
                        summary: finalWorkerResult.summary,
                        affectedFiles: finalWorkerResult.affected_files,
                        cwd: ctx.cwd,
                    },
                    originalTask: node.task,
                    signal,
                    eventBus,
                });

                if (confirmResult.type === 'return_work') {
                    finalWorkerResult = {
                        summary: confirmResult.summary,
                        affected_files: confirmResult.affected_files,
                    };
                    continue;
                }

                if (confirmResult.approved) {
                    break;
                }
            }

            eventBus.emit('squad', 'node_state', {
                nodeId,
                status: STATUS.REVIEWING,
                timestamp: Date.now(),
            });

            reviewerSlot = await modelPool.acquire('reviewer', signal);

            const reviewResult = await runReviewer({
                node,
                workerResult: finalWorkerResult,
                ctx,
                pi,
                signal,
                eventBus,
                modelSlot: reviewerSlot,
            });

            modelPool.release(reviewerSlot);
            reviewerSlot = null;

            if (!reviewResult) {
                throw new Error('Reviewer returned null');
            }

            if (reviewResult.approved) {
                eventBus.emit('squad', 'node_state', {
                    nodeId,
                    status: STATUS.APPROVED,
                    timestamp: Date.now(),
                });

                return {
                    nodeId,
                    status: STATUS.APPROVED,
                    summary: finalWorkerResult.summary,
                    affectedFiles: finalWorkerResult.affected_files,
                };
            }

            retryCount++;
            reviewerFeedback = reviewResult.feedback;

            eventBus.emit('squad', 'node_state', {
                nodeId,
                status: STATUS.REJECTED,
                retryCount,
                timestamp: Date.now(),
            });
        }
    } catch (error) {
        if (workerSlot) modelPool.release(workerSlot);
        if (reviewerSlot) modelPool.release(reviewerSlot);

        const finalStatus = signal.aborted ? STATUS.FAILED : STATUS.FAILED;

        eventBus.emit('squad', 'node_state', {
            nodeId,
            status: finalStatus,
            error: error.message,
            timestamp: Date.now(),
        });

        throw error;
    }
}

export { runNode };
