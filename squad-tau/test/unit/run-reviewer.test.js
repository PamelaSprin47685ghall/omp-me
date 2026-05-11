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
    expect(prompt.indexOf(baseNode.review_criteria) < prompt.indexOf(baseNode.task)).toBeTruthy();
});

test('buildReviewerPrompt includes worker reason and affected_files', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes(baseResult.reason)).toBeTruthy();
    expect(prompt.includes(`**Summary:** ${baseResult.reason}`)).toBeTruthy();
    for (const file of baseResult.affected_files) {
        expect(prompt.includes(file)).toBeTruthy();
    }
});

test('buildReviewerPrompt mentions return tool', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes('return(')).toBeTruthy();
    expect(prompt.includes("status: 'ok'")).toBeTruthy();
    expect(prompt.includes("status: 'error'")).toBeTruthy();
});

test('buildReviewerPrompt includes all built-in review dimensions', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    expect(prompt.includes('Code Quality')).toBeTruthy();
    expect(prompt.includes('Design Flaws')).toBeTruthy();
    expect(prompt.includes('Security Vulnerabilities')).toBeTruthy();
    expect(prompt.includes('User Experience')).toBeTruthy();
    expect(prompt.includes('Goal Completeness')).toBeTruthy();
});

test('buildReviewerPrompt omits review criteria section when absent', () => {
    const node = { task: 'Add unit tests for utils' };
    const prompt = buildReviewerPrompt({ node, workerResult: baseResult });

    expect(prompt.includes('Review Criteria')).toBeFalsy();
    expect(prompt.includes(node.task)).toBeTruthy();
});
