import { topologicalSort } from './dag-sort.js';
import { validateNodes } from './dag-validate.js';
import { executeLayer } from './dag-concurrency.js';
import { STATUS } from './constants.js';

async function executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool }) {
    const { valid, errors } = validateNodes(nodes);
    if (!valid) throw new Error(`Invalid plan: ${errors.join(', ')}`);

    const layers = topologicalSort(nodes);
    const allResults = [];
    const completedNodes = new Map();
    const failedNodes = new Set();

    for (const layer of layers) {
        if (signal.aborted) {
            handleAbortedLayer(layer, completedNodes, allResults, failedNodes, eventBus);
            continue;
        }

        const { nodesToExecute, blockedNodes } = partitionNodes(layer, failedNodes);
        handleBlockedNodes(blockedNodes, allResults, completedNodes, failedNodes, eventBus);

        if (nodesToExecute.length > 0) {
            await executeLayerWithResults(nodesToExecute, completedNodes, allResults, failedNodes, {
                ctx,
                pi,
                signal,
                eventBus,
                modelPool,
            });
        }
    }

    // Ensure any remaining unprocessed nodes (from layers skipped by abort
    // or blocked by failed deps) get a terminal state visible to the client.
    for (const node of nodes) {
        if (!completedNodes.has(node.id)) {
            const hasFailedDep = (node.depends_on || []).some((d) => failedNodes.has(d));
            const result = {
                nodeId: node.id,
                status: hasFailedDep ? STATUS.BLOCKED : STATUS.FAILED,
                summary: hasFailedDep ? 'Blocked by failed upstream' : 'Unreachable due to abort',
                affectedFiles: [],
            };
            allResults.push(result);
            completedNodes.set(node.id, result);
            eventBus.emit('squad', 'node_state', {
                nodeId: node.id,
                status: result.status,
                retryCount: 0,
            });
        }
    }

    return allResults;
}

function handleAbortedLayer(layer, completedNodes, allResults, failedNodes, eventBus) {
    for (const node of layer) {
        if (!completedNodes.has(node.id)) {
            const result = {
                nodeId: node.id,
                status: STATUS.FAILED,
                summary: 'Aborted by signal',
                affectedFiles: [],
            };
            allResults.push(result);
            completedNodes.set(node.id, result);
            failedNodes.add(node.id);
            eventBus.emit('squad', 'node_state', { nodeId: node.id, status: STATUS.FAILED, retryCount: 0 });
        }
    }
}

function partitionNodes(layer, failedNodes) {
    const nodesToExecute = [];
    const blockedNodes = [];

    for (const node of layer) {
        const dependencies = node.depends_on || [];
        const hasFailedDependency = dependencies.some((depId) => failedNodes.has(depId));

        if (hasFailedDependency) {
            blockedNodes.push(node);
        } else {
            nodesToExecute.push(node);
        }
    }
    return { nodesToExecute, blockedNodes };
}

function handleBlockedNodes(blockedNodes, allResults, completedNodes, failedNodes, eventBus) {
    for (const node of blockedNodes) {
        const result = {
            nodeId: node.id,
            status: STATUS.BLOCKED,
            summary: 'Blocked by failed upstream dependency',
            affectedFiles: [],
        };
        allResults.push(result);
        completedNodes.set(node.id, result);
        failedNodes.add(node.id);
        eventBus.emit('squad', 'node_state', { nodeId: node.id, status: STATUS.BLOCKED, retryCount: 0 });
    }
}

async function executeLayerWithResults(nodesToExecute, completedNodes, allResults, failedNodes, deps) {
    const { ctx, pi, signal, eventBus, modelPool } = deps;
    const upstreamResults = Array.from(completedNodes.values());
    const layerCtx = { ...ctx, upstreamResults };

    const layerResults = await executeLayer(nodesToExecute, layerCtx, pi, signal, eventBus, modelPool);

    for (const result of layerResults) {
        allResults.push(result);
        completedNodes.set(result.nodeId, result);

        if (result.status === STATUS.FAILED || result.status === STATUS.BLOCKED) {
            failedNodes.add(result.nodeId);
        }
    }
}

export { executeDAG };
