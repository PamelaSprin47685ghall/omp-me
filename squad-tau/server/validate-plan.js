function validatePlan(plan) {
    const errors = [];

    if (!plan || typeof plan !== 'object') {
        errors.push('plan must be an object');
        return { valid: false, errors };
    }

    if (plan.mode !== 'M' && plan.mode !== 'L') {
        errors.push('plan.mode must be "M" or "L"');
    }

    if (!Array.isArray(plan.nodes)) {
        errors.push('plan.nodes must be an array');
        return { valid: false, errors };
    }

    if (plan.nodes.length === 0) {
        errors.push('plan.nodes must not be empty');
    }

    if (plan.mode === 'M' && plan.nodes.length !== 1) {
        errors.push('M mode requires exactly one node');
    }

    const seenIds = new Set();
    for (let i = 0; i < plan.nodes.length; i++) {
        const node = plan.nodes[i];
        const prefix = `node[${i}]`;

        if (!node || typeof node !== 'object') {
            errors.push(`${prefix} must be an object`);
            continue;
        }

        if (typeof node.id !== 'string' || node.id.trim() === '') {
            errors.push(`${prefix}.id must be a non-empty string`);
        } else {
            if (seenIds.has(node.id)) {
                errors.push(`${prefix}.id "${node.id}" is duplicated`);
            }
            seenIds.add(node.id);
        }

        if (typeof node.task !== 'string' || node.task.trim() === '') {
            errors.push(`${prefix}.task must be a non-empty string`);
        }

        if (typeof node.review_criteria !== 'string' && !Array.isArray(node.review_criteria)) {
            errors.push(`${prefix}.review_criteria must be a string or array`);
        } else if (Array.isArray(node.review_criteria)) {
            if (node.review_criteria.length === 0) {
                errors.push(`${prefix}.review_criteria array must not be empty`);
            }
            for (let j = 0; j < node.review_criteria.length; j++) {
                if (typeof node.review_criteria[j] !== 'string') {
                    errors.push(`${prefix}.review_criteria[${j}] must be a string`);
                }
            }
        } else if (node.review_criteria.trim() === '') {
            errors.push(`${prefix}.review_criteria string must not be empty`);
        }

        if (plan.mode === 'M' && node.depends_on) {
            errors.push(`${prefix}.depends_on is not allowed in M mode`);
        }

        if (node.depends_on !== undefined) {
            if (!Array.isArray(node.depends_on)) {
                errors.push(`${prefix}.depends_on must be an array if present`);
            } else {
                for (let j = 0; j < node.depends_on.length; j++) {
                    if (typeof node.depends_on[j] !== 'string') {
                        errors.push(`${prefix}.depends_on[${j}] must be a string`);
                    }
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

export { validatePlan };
