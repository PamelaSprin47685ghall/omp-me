const REVIEW_DIMENSIONS = [
    { title: 'Code Quality', desc: 'Is the code correct, clear, and idiomatic?' },
    { title: 'Design Flaws', desc: 'Are there architectural issues or tight coupling?' },
    { title: 'Security Vulnerabilities', desc: 'Injection, privilege escalation, data leakage?' },
    { title: 'User Experience', desc: 'Can callers use this correctly and naturally?' },
    { title: 'Goal Completeness', desc: 'Does it fully satisfy the requirements?' },
];

function formatReviewCriteria(criteria) {
    if (Array.isArray(criteria) && criteria.length > 0 && typeof criteria[0] === 'object' && criteria[0] !== null) {
        return criteria.map((c) => `- ${c.name}: ${c.description}`).join('\n');
    }
    if (Array.isArray(criteria)) {
        return criteria.join('\n');
    }
    return String(criteria);
}

export function buildReviewerPrompt({ node, workerResult }) {
    const dimensionsList = REVIEW_DIMENSIONS.map((d) => `- **${d.title}** — ${d.desc}`).join('\n');

    const filesList = workerResult.affected_files.map((f) => `  - ${f}`).join('\n');

    const sections = [];

    if (node.review_criteria) {
        sections.push('## Review Criteria (MUST address these)', '', formatReviewCriteria(node.review_criteria), '');
    }

    sections.push(
        '## Task',
        '',
        node.task,
        '',
        '## Worker Submission',
        '',
        `**Summary:** ${workerResult.reason}`,
        '',
        '**Affected files:**',
        filesList,
        '',
        '## Built-in Review Dimensions',
        '',
        dimensionsList,
        '',
        '## Instructions',
        '',
        'You are a code reviewer. Use the read-only tools available to inspect the changed files.',
        'Address the review criteria above and evaluate against the built-in dimensions.',
        'End by calling the `return` tool with **one** of:',
        "  - `return({ status: 'ok', reason: string })` if the submission is acceptable",
        "  - `return({ status: 'error', reason: string })` if changes are needed",
    );

    return sections.join('\n');
}
