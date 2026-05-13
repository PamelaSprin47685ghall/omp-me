function formatReviewCriteria(criteria) {
    if (!criteria) return '';
    if (typeof criteria === 'string') return criteria;
    if (Array.isArray(criteria)) {
        if (criteria.length === 0) return '';
        if (typeof criteria[0] === 'object' && criteria[0] !== null) {
            return criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
        }
        return criteria.join('\n');
    }
    return String(criteria);
}

function buildIterationHistory(history) {
    if (!history || history.length === 0) return '';
    const lines = [];
    for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        lines.push(`工作记录 (${i + 1}): ${entry.workRecord?.reason || ''}`);
        if (entry.workRecord?.affected_files?.length > 0) {
            lines.push(`  文件: ${entry.workRecord.affected_files.join(', ')}`);
        }
        lines.push(`审阅者反馈 (${i + 1}): ${entry.feedback || ''}`);
    }
    return lines.join('\n');
}

export { formatReviewCriteria, buildIterationHistory };
