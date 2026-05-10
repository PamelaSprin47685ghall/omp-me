const REQUIRED_FIELDS = ['id', 'task', 'review_criteria'];

export function validateNodes(nodes) {
    const errors = [];

    if (!Array.isArray(nodes) || nodes.length === 0) {
        return { valid: false, errors: ['nodes must be a non-empty array'] };
    }

    const ids = new Set();

    for (const node of nodes) {
        if (node.id != null) {
            if (ids.has(node.id)) {
                errors.push(`duplicate node id: "${node.id}"`);
            }
            ids.add(node.id);
        }
    }

    for (const node of nodes) {
        const missing = REQUIRED_FIELDS.filter((f) => node[f] == null || node[f] === '');
        if (missing.length > 0) {
            const label = node.id ?? JSON.stringify(node);
            errors.push(`node ${label} is missing required fields: ${missing.join(', ')}`);
        }
    }

    for (const node of nodes) {
        const deps = node.depends_on;
        if (!Array.isArray(deps)) continue;
        for (const depId of deps) {
            if (!ids.has(depId)) {
                errors.push(`node "${node.id}" depends on unknown node: "${depId}"`);
            }
        }
    }

    return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}
