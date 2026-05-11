export default function buildConfirmPrompt(node) {
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
