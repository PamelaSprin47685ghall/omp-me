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

        const rc = node.review_criteria;
        if (typeof rc === 'string') {
            if (rc.trim() === '') {
                errors.push(`${prefix}.review_criteria must not be empty`);
            }
        } else if (Array.isArray(rc)) {
            if (rc.length === 0) {
                errors.push(`${prefix}.review_criteria must not be empty`);
            } else if (typeof rc[0] === 'string') {
                for (let j = 0; j < rc.length; j++) {
                    if (typeof rc[j] !== 'string' || rc[j].trim() === '') {
                        errors.push(`${prefix}.review_criteria[${j}] must not be empty`);
                    }
                }
            } else if (typeof rc[0] === 'object' && rc[0] !== null) {
                for (let j = 0; j < rc.length; j++) {
                    const item = rc[j];
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
            } else {
                errors.push(
                    `${prefix}.review_criteria must be a non-empty string, array of strings, or array of {name, description} objects`,
                );
            }
        } else {
            errors.push(
                `${prefix}.review_criteria must be a non-empty string, array of strings, or array of {name, description} objects`,
            );
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
