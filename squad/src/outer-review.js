import { runSession, buildReviewerSessionOptions, buildApproveTool, buildRejectTool } from './review-fsm.js';

export async function runOuterReview(nodes, results, originalTask, round, ctx, pi, signal, viewManager) {
    const { promise, resolve } = Promise.withResolvers();

    const options = buildReviewerSessionOptions(ctx, pi);
    const promptText = buildTotalReviewerPrompt(nodes, results, originalTask, round);

    await runSession(pi, options, promptText, signal, [
        () => buildApproveTool(resolve),
        () => buildRejectTool(resolve),
    ]);

    return await promise;
}

function buildTotalReviewerPrompt(nodes, results, originalTask, round) {
    const fileList = results.flatMap((r) => r.affected_files || []);
    const summaries = results
        .map((r) => `- **${r.id}**: ${r.summary} (files: ${(r.affected_files || []).join(', ')})`)
        .join('\n');

    return [
        '## Outer Review — Cross-Node Consistency',
        round > 0 ? `(Round ${round + 1})` : '',
        '',
        '## Original Request',
        originalTask || '(not provided)',
        '',
        'The following nodes have been completed:',
        summaries,
        '',
        'All affected files:',
        fileList.join(', '),
        '',
        '## Review Dimensions',
        "1. Cross-Node Consistency — do the nodes' changes work together? No interface mismatches?",
        '2. No Duplication — do any two nodes implement overlapping logic?',
        '3. Goal Completeness — does the combined output satisfy the original request?',
        '4. Style Consistency — are error handling, naming, config patterns uniform?',
        '5. Missing Pieces — are there cross-cutting concerns no node addressed?',
        '',
        '---',
        'Use `read` to inspect affected files. If ALL dimensions pass, call `approve`.',
        'If any dimension fails, call `reject` with specific, actionable feedback.',
        'Do NOT write or modify any code. Your job is to review, not to fix.',
    ].join('\n');
}
