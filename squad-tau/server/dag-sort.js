export function topologicalSort(nodes) {
    if (!nodes || nodes.length === 0) {
        throw new Error('topologicalSort: nodes array cannot be empty');
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const inDegree = new Map();
    const adjList = new Map();

    for (const node of nodes) {
        inDegree.set(node.id, 0);
        adjList.set(node.id, []);
    }

    for (const node of nodes) {
        const deps = node.depends_on || [];
        for (const depId of deps) {
            if (!nodeMap.has(depId)) {
                throw new Error(`topologicalSort: node ${node.id} depends on non-existent node ${depId}`);
            }
            adjList.get(depId).push(node.id);
            inDegree.set(node.id, inDegree.get(node.id) + 1);
        }
    }

    const layers = [];
    let queue = Array.from(inDegree.entries())
        .filter(([_, deg]) => deg === 0)
        .map(([id, _]) => id);

    const processed = new Set();

    while (queue.length > 0) {
        layers.push([...queue]);
        const nextQueue = [];

        for (const nodeId of queue) {
            processed.add(nodeId);
            for (const neighbor of adjList.get(nodeId)) {
                const newDegree = inDegree.get(neighbor) - 1;
                inDegree.set(neighbor, newDegree);
                if (newDegree === 0) {
                    nextQueue.push(neighbor);
                }
            }
        }

        queue = nextQueue;
    }

    if (processed.size !== nodes.length) {
        const unprocessed = nodes.filter((n) => !processed.has(n.id)).map((n) => n.id);
        throw new Error(`topologicalSort: cycle detected involving nodes: ${unprocessed.join(', ')}`);
    }

    return { layers };
}
