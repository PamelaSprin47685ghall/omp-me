import { describe, test, expect } from 'bun:test';
import { runOuterReview } from '../../server/outer-review.js';

function buildOuterReviewPrompt(originalTask, nodeResults, round) {
    const nodesSummary = nodeResults
        .map((n) => {
            const files = n.affectedFiles?.length ? `\n  Affected files: ${n.affectedFiles.join(', ')}` : '';
            return `- Node ${n.id} (${n.status}): ${n.summary}${files}`;
        })
        .join('\n');

    return `You are the outer reviewer for a multi-node squad execution (round ${round}).

Original task:
${originalTask}

All nodes have completed. Here are the results:
${nodesSummary}

Your job:
1. Read the affected files to verify the aggregated result satisfies the original task
2. Check for integration issues, missing pieces, or inconsistencies across nodes
3. Decide:
   - approve({ comment }) if the work is complete and correct
   - reject({ feedback }) if revisions are needed

You have access to: read, search, find, lsp, bash (read-only).
You MUST call approve() or reject() to complete this review.`;
}

describe('buildOuterReviewPrompt', () => {
    test('includes original task and round', () => {
        const nodeResults = [{ id: 'n1', status: 'approved', summary: 'Done A', affectedFiles: ['a.js'] }];
        const prompt = buildOuterReviewPrompt('Build feature X', nodeResults, 2);

        expect(prompt).toContain('round 2');
        expect(prompt).toContain('Build feature X');
    });

    test('lists all node results with status and summary', () => {
        const nodeResults = [
            { id: 'n1', status: 'approved', summary: 'Done A', affectedFiles: ['a.js'] },
            { id: 'n2', status: 'approved', summary: 'Done B', affectedFiles: ['b.js', 'c.js'] },
        ];
        const prompt = buildOuterReviewPrompt('Build feature X', nodeResults, 1);

        expect(prompt).toContain('Node n1 (approved): Done A');
        expect(prompt).toContain('Affected files: a.js');
        expect(prompt).toContain('Node n2 (approved): Done B');
        expect(prompt).toContain('Affected files: b.js, c.js');
    });

    test('mentions approve and reject tools', () => {
        const nodeResults = [{ id: 'n1', status: 'approved', summary: 'Done', affectedFiles: [] }];
        const prompt = buildOuterReviewPrompt('Task', nodeResults, 1);

        expect(prompt).toContain('approve({ comment })');
        expect(prompt).toContain('reject({ feedback })');
        expect(prompt).toContain('MUST call approve() or reject()');
    });

    test('lists available tools', () => {
        const nodeResults = [{ id: 'n1', status: 'approved', summary: 'Done', affectedFiles: [] }];
        const prompt = buildOuterReviewPrompt('Task', nodeResults, 1);

        expect(prompt).toContain('read, search, find, lsp, bash');
    });
});
