function hasCycle(nodes) {
    const adj = {};
    for (const n of nodes) adj[n.id] = n.depends_on || [];
    const visited = new Set(),
        stack = new Set();
    function dfs(id) {
        if (stack.has(id)) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        stack.add(id);
        for (const dep of adj[id] || []) {
            if (dfs(dep)) return true;
        }
        stack.delete(id);
        return false;
    }
    for (const n of nodes) {
        if (dfs(n.id)) return true;
    }
    return false;
}

function validatePlan(plan) {
    const errors = [];
    const nodes = plan?.nodes || [];
    if (hasCycle(nodes)) {
        errors.push('plan contains a cyclic dependency');
    }
    return { valid: errors.length === 0, errors };
}

export { validatePlan };
