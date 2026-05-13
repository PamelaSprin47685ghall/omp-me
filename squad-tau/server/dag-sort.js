export function topologicalSort(nodes) {
    if (!nodes || nodes.length === 0) throw new Error('topologicalSort: nodes array cannot be empty');
    const { adjList, inDegree, nodeMap } = buildGraph(nodes);
    const layers = kahnLayers(nodes, adjList, inDegree, nodeMap);
    const processed = countProcessed(layers);
    if (processed !== nodes.length) {
        const done = new Set();
        for (const layer of layers) for (const n of layer) done.add(n.id);
        const unprocessed = nodes.filter((n) => !done.has(n.id)).map((n) => n.id);
        throw new Error(`topologicalSort: cycle detected involving nodes: ${unprocessed.join(', ')}`);
    }
    return layers;
}

function buildGraph(nodes) {
    const nodeMap = new Map(),
        adjList = new Map(),
        inDegree = new Map();
    for (const n of nodes) {
        if (nodeMap.has(n.id)) throw new Error(`topologicalSort: duplicate node ID found: ${n.id}`);
        nodeMap.set(n.id, n);
        inDegree.set(n.id, 0);
        adjList.set(n.id, []);
    }
    for (const n of nodes) {
        for (const dep of n.depends_on || []) {
            if (!nodeMap.has(dep)) throw new Error(`topologicalSort: node ${n.id} depends on non-existent node ${dep}`);
            adjList.get(dep).push(n.id);
            inDegree.set(n.id, inDegree.get(n.id) + 1);
        }
    }
    return { adjList, inDegree, nodeMap };
}

function kahnLayers(nodes, adjList, inDegree, nodeMap) {
    const layers = [];
    let queue = Array.from(inDegree.entries())
        .filter(([_, deg]) => deg === 0)
        .map(([id, _]) => id);

    while (queue.length > 0) {
        layers.push(queue.map((id) => nodeMap.get(id)));
        const nextQueue = [];
        for (const id of queue) {
            for (const nb of adjList.get(id)) {
                const newDegree = inDegree.get(nb) - 1;
                inDegree.set(nb, newDegree);
                if (newDegree === 0) nextQueue.push(nb);
            }
        }
        queue = nextQueue;
    }
    return layers;
}

function countProcessed(layers) {
    let count = 0;
    for (const layer of layers) count += layer.length;
    return count;
}
