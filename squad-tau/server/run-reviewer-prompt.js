const REVIEW_DIMENSIONS = [
    { title: 'Code Quality', desc: 'Is the code correct, clear, and idiomatic?' },
    { title: 'Design Flaws', desc: 'Are there architectural issues or tight coupling?' },
    { title: 'Security Vulnerabilities', desc: 'Injection, privilege escalation, data leakage?' },
    { title: 'User Experience', desc: 'Can callers use this correctly and naturally?' },
    { title: 'Goal Completeness', desc: 'Does it fully satisfy the requirements?' },
];

export function buildReviewerPrompt({ node, workerResult }) {
    const dimensionsList = REVIEW_DIMENSIONS.map((d) => `- **${d.title}** — ${d.desc}`).join('\n');

    const filesList = workerResult.affected_files.map((f) => `  - ${f}`).join('\n');

    const sections = [];

    if (node.review_criteria) {
        sections.push('## Review Criteria (MUST address these)', '', node.review_criteria, '');
    }

    sections.push(
        '## Task',
        '',
        node.task,
        '',
        '## Worker Submission',
        '',
        `**Summary:** ${workerResult.summary}`,
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
        'End by calling **one** of:',
        '  - `approve({ comment })` if the submission is acceptable',
        '  - `reject({ feedback })` if changes are needed',
    );

    return sections.join('\n');
}
