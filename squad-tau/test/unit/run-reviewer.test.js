import { test } from 'node:test';
import assert from 'node:assert/strict';
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

    assert.ok(prompt.includes(baseNode.task), 'Must include node task');
    assert.ok(prompt.includes(baseNode.review_criteria), 'Must include review_criteria');
    assert.ok(
        prompt.indexOf(baseNode.review_criteria) < prompt.indexOf(baseNode.task),
        'review_criteria must appear before task',
    );
});

test('buildReviewerPrompt includes worker reason and affected_files', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    assert.ok(prompt.includes(baseResult.reason), 'Must include worker reason');
    assert.ok(prompt.includes(`**Summary:** ${baseResult.reason}`), 'Must prefix reason with Summary label');
    for (const file of baseResult.affected_files) {
        assert.ok(prompt.includes(file), `Must include affected file: ${file}`);
    }
});

test('buildReviewerPrompt mentions return tool', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    assert.ok(prompt.includes('return('), 'Must mention return()');
    assert.ok(prompt.includes("status: 'ok'"), "Must mention status: 'ok'");
    assert.ok(prompt.includes("status: 'error'"), "Must mention status: 'error'");
});

test('buildReviewerPrompt includes all built-in review dimensions', () => {
    const prompt = buildReviewerPrompt({ node: baseNode, workerResult: baseResult });

    assert.ok(prompt.includes('Code Quality'), 'Must include Code Quality');
    assert.ok(prompt.includes('Design Flaws'), 'Must include Design Flaws');
    assert.ok(prompt.includes('Security Vulnerabilities'), 'Must include Security Vulnerabilities');
    assert.ok(prompt.includes('User Experience'), 'Must include User Experience');
    assert.ok(prompt.includes('Goal Completeness'), 'Must include Goal Completeness');
});

test('buildReviewerPrompt omits review criteria section when absent', () => {
    const node = { task: 'Add unit tests for utils' };
    const prompt = buildReviewerPrompt({ node, workerResult: baseResult });

    assert.ok(!prompt.includes('Review Criteria'), 'Must not include review criteria heading');
    assert.ok(prompt.includes(node.task), 'Must still include task');
});
