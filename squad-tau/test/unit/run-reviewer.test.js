import { test, expect } from 'bun:test';
import { buildReviewerPrompt } from '../../server/run-reviewer-prompt.js';

const baseNode = {
    task: 'Implement JWT authentication middleware',
    review_criteria: 'Check token expiry handling and revocation logic',
};

const baseResult = {
    reason: 'Added JWT middleware with expiry and revocation checks',
    affected_files: ['src/auth/jwt.js', 'src/middleware/auth.js'],
};

test('buildReviewerPrompt includes node task and review_criteria', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes(baseNode.task)).toBeTruthy();
    expect(prompt.includes(baseNode.review_criteria)).toBeTruthy();
    expect(prompt.indexOf(baseNode.review_criteria) > prompt.indexOf(baseNode.task)).toBeTruthy();
});

test('buildReviewerPrompt includes worker reason and affected_files', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes(baseResult.reason)).toBeTruthy();
    for (const file of baseResult.affected_files) {
        expect(prompt.includes(file)).toBeTruthy();
    }
});

test('buildReviewerPrompt mentions return tool', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes('return(')).toBeTruthy();
    expect(prompt.includes('ok')).toBeTruthy();
    expect(prompt.includes('error')).toBeTruthy();
});

test('buildReviewerPrompt includes all 4 review dimensions from AGENTS.md', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes('代码质量')).toBeTruthy();
    expect(prompt.includes('设计缺陷')).toBeTruthy();
    expect(prompt.includes('用户体验')).toBeTruthy();
    expect(prompt.includes('目标完整性')).toBeTruthy();
});

test('buildReviewerPrompt omits review criteria section when absent', () => {
    const node = { task: 'Add unit tests for utils' };
    const prompt = buildReviewerPrompt({ node, workerResult: baseResult });

    expect(prompt.includes('评审标准')).toBeFalsy();
    expect(prompt.includes(node.task)).toBeTruthy();
});

test('buildReviewerPrompt includes role opening', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes('审核专员')).toBeTruthy();
});

test('buildReviewerPrompt includes iteration history when provided', () => {
    const history = [
        {
            workRecord: { reason: 'First attempt', affected_files: ['src/auth.js'] },
            feedback: 'Add error handling',
        },
    ];
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult, iterationHistory: history });

    expect(prompt.includes('工作记录 (1)')).toBeTruthy();
    expect(prompt.includes('审阅者反馈 (1)')).toBeTruthy();
    expect(prompt.includes('First attempt')).toBeTruthy();
    expect(prompt.includes('Add error handling')).toBeTruthy();
});
