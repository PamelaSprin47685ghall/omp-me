function validatePlan(plan) {
    const errors = [];
    if (!validateBasicPlanStructure(plan, errors)) return { valid: false, errors };

    const seenIds = new Set();
    validateNodes(plan, errors, seenIds);

    // Cycle detection via DFS
    if (hasCycle(plan.nodes)) {
        errors.push('plan contains a cyclic dependency');
    }

    return { valid: errors.length === 0, errors };
}

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

function validateBasicPlanStructure(plan, errors) {
    if (!plan || typeof plan !== 'object') {
        errors.push('plan must be an object');
        return false;
    }
    if (plan.mode !== 'M' && plan.mode !== 'L') {
        errors.push('plan.mode must be "M" or "L"');
    }
    if (!Array.isArray(plan.nodes)) {
        errors.push('plan.nodes must be an array');
        return false;
    }
    if (plan.nodes.length === 0) {
        errors.push('plan.nodes must not be empty');
    }
    if (plan.mode === 'M' && plan.nodes.length !== 1) {
        errors.push('M mode requires exactly one node');
    }
    return true;
}

function validateNodes(plan, errors, seenIds) {
    // Pass 1: collect all IDs before validating dependencies
    for (let i = 0; i < plan.nodes.length; i++) {
        const node = plan.nodes[i];
        const prefix = `node[${i}]`;
        if (!node || typeof node !== 'object') {
            errors.push(`${prefix} must be an object`);
            continue;
        }
        validateNodeId(node, prefix, errors, seenIds);
    }
    // Pass 2: validate fields + dependencies (seenIds is now complete)
    for (let i = 0; i < plan.nodes.length; i++) {
        const node = plan.nodes[i];
        if (!node || typeof node !== 'object') continue;
        const prefix = `node[${i}]`;
        validateNodeTask(node, prefix, errors);
        validateReviewCriteria(node.review_criteria, prefix, errors);
        validateDependencies(plan.mode, node, prefix, errors, seenIds);
    }
}

function validateNodeId(node, prefix, errors, seenIds) {
    if (typeof node.id !== 'string' || node.id.trim() === '') {
        errors.push(`${prefix}.id must be a non-empty string`);
    } else {
        if (seenIds.has(node.id)) {
            errors.push(`${prefix}.id "${node.id}" is duplicated`);
        }
        seenIds.add(node.id);
    }
}

function validateNodeTask(node, prefix, errors) {
    if (typeof node.task !== 'string' || node.task.trim() === '') {
        errors.push(`${prefix}.task must be a non-empty string`);
    }
}

function validateReviewCriteria(rc, prefix, errors) {
    if (typeof rc === 'string') {
        if (rc.trim() === '') errors.push(`${prefix}.review_criteria must not be empty`);
    } else if (Array.isArray(rc)) {
        if (rc.length === 0) {
            errors.push(`${prefix}.review_criteria must not be empty`);
        } else {
            validateReviewCriteriaArray(rc, prefix, errors);
        }
    } else {
        errors.push(
            `${prefix}.review_criteria must be a non-empty string, array of strings, or array of {name, description} objects`,
        );
    }
}

function validateReviewCriteriaArray(rc, prefix, errors) {
    if (typeof rc[0] === 'string') {
        for (let j = 0; j < rc.length; j++) {
            if (typeof rc[j] !== 'string' || rc[j].trim() === '') {
                errors.push(`${prefix}.review_criteria[${j}] must not be empty`);
            }
        }
    } else if (typeof rc[0] === 'object' && rc[0] !== null) {
        for (let j = 0; j < rc.length; j++) {
            validateReviewCriteriaItem(rc[j], j, prefix, errors);
        }
    } else {
        errors.push(
            `${prefix}.review_criteria must be a non-empty string, array of strings, or array of {name, description} objects`,
        );
    }
}

function validateReviewCriteriaItem(item, j, prefix, errors) {
    if (!item || typeof item !== 'object') {
        errors.push(`${prefix}.review_criteria[${j}] must be an object`);
    } else {
        if (typeof item.name !== 'string' || item.name.trim() === '') {
            errors.push(`${prefix}.review_criteria[${j}].name must be a non-empty string`);
        }
        if (typeof item.description !== 'string' || item.description.trim() === '') {
            errors.push(`${prefix}.review_criteria[${j}].description must be a non-empty string`);
        }
    }
}

function validateDependencies(mode, node, prefix, errors, seenIds) {
    if (mode === 'M' && node.depends_on && node.depends_on.length > 0) {
        errors.push(`${prefix}.depends_on is not allowed in M mode`);
    }
    if (node.depends_on !== undefined) {
        if (!Array.isArray(node.depends_on)) {
            errors.push(`${prefix}.depends_on must be an array if present`);
        } else {
            for (let j = 0; j < node.depends_on.length; j++) {
                const dep = node.depends_on[j];
                if (typeof dep !== 'string') {
                    errors.push(`${prefix}.depends_on[${j}] must be a string`);
                } else if (!seenIds.has(dep)) {
                    errors.push(`${prefix}.depends_on[${j}] references unknown node "${dep}"`);
                }
            }
        }
    }
}

export { validatePlan };
