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

export { buildWorkerPrompt, buildConfirmPrompt };

function buildConfirmPrompt(node) {
    const task = typeof node === 'string' ? node : node.task;
    const criteria = node?.review_criteria || [];

    let criteriaSection = '';
    if (criteria.length > 0) {
        criteriaSection = criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
    }

    return `You are the self-confirm reviewer for a completed task. Review the work by re-reading the original task description and the affected files listed below. Use the ORIGINAL TASK DESCRIPTION — not the worker's summary — to catch any hallucinations or omissions.

## Original Task Description
${task}

## Review Dimensions
1. Code Quality — Is the code correct, clear, and idiomatic?
2. Design Flaws — Are there architectural issues, tight coupling, or unnecessary complexity?
3. Security Vulnerabilities — Is there injection risk, permission bypass, or data leakage?
4. User Experience — Is the API or interface easy and safe for callers to use?
5. Goal Completeness — Does the work fully satisfy the original task requirements?

${criteriaSection ? `## Review Criteria\n${criteriaSection}\n\n` : ''}## Instructions
- If you find no issues, call \`return({ status: 'ok', reason: string, affected_files?: string[] })\` to approve and submit.
- If anything needs fixing, call \`return({ status: 'error', reason: string })\` to indicate the issues and trigger a re-submit.
- When returning ok, the reason should briefly confirm why the work is acceptable. When returning error, the reason must describe the required changes.`;
}
