function formatReviewCriteria(criteria) {
    if (!criteria) return null;
    if (typeof criteria === 'string') return criteria;
    if (Array.isArray(criteria)) {
        if (criteria.length === 0) return null;
        if (typeof criteria[0] === 'string') return criteria.join('\n');
        return criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
    }
    return null;
}

function buildWorkerPrompt(node, upstreamResults, reviewerFeedback) {
    const lines = [`## Task\n${node.task}`];

    if (upstreamResults && upstreamResults.length > 0) {
        lines.push('\n## Context from Upstream Tasks');
        for (const upstream of upstreamResults) {
            const fileList = (upstream.affected_files || []).join(', ');
            lines.push(`- **${upstream.id}**: ${upstream.summary}`);
            if (fileList) lines.push(`  Files: ${fileList}`);
        }
        lines.push('\nUse the `read` tool to inspect upstream files as needed.');
    }

    if (reviewerFeedback) {
        lines.push('\n## Reviewer Feedback from Previous Attempt');
        lines.push(reviewerFeedback);
        lines.push('\nAddress every issue listed above before resubmitting.');
    }

    const criteriaText = formatReviewCriteria(node.review_criteria);
    if (criteriaText) {
        lines.push('\n## Review Criteria (MUST address these)');
        lines.push(criteriaText);
    }

    lines.push(
        '\n---',
        'Complete this task. When finished, you MUST call the `return` tool with:',
        '- `reason`: concise description of what you accomplished',
        '- `affected_files`: every file you created or modified',
        '',
        'Do NOT output prose to signal completion — only the tool call counts.',
    );

    return lines.join('\n');
}

export { buildWorkerPrompt };
