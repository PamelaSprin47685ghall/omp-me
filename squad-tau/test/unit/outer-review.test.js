import { describe, test, expect } from 'bun:test';
import { runOuterReview, buildOuterReviewPrompt } from '../../server/outer-review.js';

describe('buildOuterReviewPrompt', () => {
    test('includes original task and node results header', () => {
        const nodeResults = [{ id: 'n1', status: 'approved', summary: 'Done A', affectedFiles: ['a.js'] }];
        const prompt = buildOuterReviewPrompt('Build feature X', nodeResults, 2);

        expect(prompt).toContain('原始任务:');
        expect(prompt).toContain('节点结果:');
        expect(prompt).toContain('Build feature X');
    });

    test('lists all node results with status and summary', () => {
        const nodeResults = [
            { id: 'n1', status: 'approved', summary: 'Done A', affectedFiles: ['a.js'] },
            { id: 'n2', status: 'approved', summary: 'Done B', affectedFiles: ['b.js', 'c.js'] },
        ];
        const prompt = buildOuterReviewPrompt('Build feature X', nodeResults, 1);

        expect(prompt).toContain('- n1 (approved): Done A');
        expect(prompt).toContain('文件: a.js');
        expect(prompt).toContain('- n2 (approved): Done B');
        expect(prompt).toContain('文件: b.js, c.js');
    });

    test('mentions return status ok and error', () => {
        const nodeResults = [{ id: 'n1', status: 'approved', summary: 'Done', affectedFiles: [] }];
        const prompt = buildOuterReviewPrompt('Task', nodeResults, 1);

        expect(prompt).toContain('return({ status: "ok", reason: "..." })');
        expect(prompt).toContain('return({ status: "error", reason: "..." })');
        expect(prompt).toContain('聚合结果是否满足原始任务？');
    });
});
