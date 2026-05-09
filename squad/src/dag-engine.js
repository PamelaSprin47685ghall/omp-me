import { runNode } from './review-fsm.js';
import { loadModelsConfig, createModelPool } from './model-pool.js';

const FALLBACK_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// DAG validation
// ---------------------------------------------------------------------------

function validateNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('nodes must be a non-empty array');
    }

    const ids = new Set();

    for (const node of nodes) {
        if (!node.id || typeof node.id !== 'string') {
            throw new Error(`node is missing a valid id: ${JSON.stringify(node)}`);
        }
        if (ids.has(node.id)) {
            throw new Error(`duplicate node id: ${node.id}`);
        }
        ids.add(node.id);

        if (!node.task || typeof node.task !== 'string') {
            throw new Error(`node "${node.id}" is missing a valid task`);
        }
        if (
            !node.review_criteria ||
            (typeof node.review_criteria !== 'string' &&
                (!Array.isArray(node.review_criteria) || !node.review_criteria.every((c) => typeof c === 'string')))
        ) {
            throw new Error(`node "${node.id}" is missing valid review_criteria`);
        }

        if (node.depends_on !== undefined) {
            if (!Array.isArray(node.depends_on)) {
                throw new Error(`node "${node.id}": depends_on must be an array`);
            }
            for (const depId of node.depends_on) {
                if (typeof depId !== 'string') {
                    throw new Error(`node "${node.id}": depends_on contains non-string entry`);
                }
            }
        }
    }

    for (const node of nodes) {
        for (const depId of node.depends_on || []) {
            if (!ids.has(depId)) {
                throw new Error(`node "${node.id}" depends on unknown node: "${depId}"`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Topological sort → execution layers
// ---------------------------------------------------------------------------

function topologicalSort(nodes) {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const dependents = new Map();
    const inDegree = new Map();

    for (const node of nodes) {
        const deps = node.depends_on || [];
        inDegree.set(node.id, deps.length);
        for (const depId of deps) {
            if (!dependents.has(depId)) dependents.set(depId, []);
            dependents.get(depId).push(node.id);
        }
    }

    const layers = [];
    const remaining = new Set(nodes.map((n) => n.id));

    while (remaining.size > 0) {
        const layer = [];
        for (const id of remaining) {
            if (inDegree.get(id) === 0) {
                layer.push(id);
            }
        }

        if (layer.length === 0) {
            throw new Error('cycle detected in DAG — cannot resolve dependencies');
        }

        layers.push(layer);

        for (const id of layer) {
            remaining.delete(id);
            for (const dependent of dependents.get(id) || []) {
                inDegree.set(dependent, inDegree.get(dependent) - 1);
            }
        }
    }

    return { layers, nodeMap };
}

// ---------------------------------------------------------------------------
// Main execution entry point
// ---------------------------------------------------------------------------

export async function executeDAG(nodes, ctx, pi, signal, viewManager) {
    validateNodes(nodes);

    const { layers, nodeMap } = topologicalSort(nodes);

    for (const node of nodes) {
        viewManager.registerNode(node.id, node.id, node.depends_on || []);
    }

    for (let layerIdx = 1; layerIdx < layers.length; layerIdx++) {
        for (const nodeId of layers[layerIdx]) {
            viewManager.updateNodeState(nodeId, 'waiting_deps');
        }
    }

    // Generate fallback config if no models config exists — unifies concurrency under ModelPool
    const modelsConfig =
        loadModelsConfig() ??
        (() => {
            const cfg = [];
            for (let i = 0; i < FALLBACK_CONCURRENCY; i++) {
                cfg.push({
                    provider: 'fallback',
                    id: `slot-${i}`,
                    role: i < Math.ceil(FALLBACK_CONCURRENCY * 0.6) ? 'worker' : 'reviewer',
                });
            }
            return cfg;
        })();
    const modelPool = createModelPool(modelsConfig);

    const results = new Map();
    const dagAbort = new AbortController();
    let parentAborted = false;

    if (signal) {
        signal.addEventListener(
            'abort',
            () => {
                parentAborted = true;
                dagAbort.abort();
                modelPool?.cancelAll('DAG execution aborted');
            },
            { once: true },
        );
    }

    const runSingleNode = async (nodeId) => {
        if (parentAborted) {
            return { id: nodeId, status: 'failed', summary: 'Aborted', affected_files: [] };
        }

        const node = nodeMap.get(nodeId);
        const depIds = node.depends_on || [];
        const upstreamResults = depIds.map((depId) => results.get(depId)).filter(Boolean);

        const result = await runNode(node, upstreamResults, ctx, pi, dagAbort.signal, viewManager, modelPool);
        results.set(nodeId, result);
        return result;
    };

    try {
        for (const layer of layers) {
            viewManager.renderWidget();

            const layerPromises = layer.map(runSingleNode);
            await Promise.all(layerPromises);

            const blocked = layer.some((id) => results.get(id)?.status === 'blocked');
            if (blocked) break;
        }
    } finally {
        modelPool?.cancelAll('DAG execution finished');
        dagAbort.abort();
    }

    viewManager.renderWidget();

    return nodes.map(
        (n) =>
            results.get(n.id) || {
                id: n.id,
                status: 'failed',
                summary: 'Not executed — blocked by upstream failure',
                affected_files: [],
            },
    );
}
