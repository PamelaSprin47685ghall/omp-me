import { test } from 'node:test';
import assert from 'node:assert/strict';
import buildConfirmPrompt from '../../server/run-confirm-prompt.js';

test('buildConfirmPrompt uses original task not worker summary', () => {
    const originalTask = 'Implement user authentication with JWT tokens';
    const prompt = buildConfirmPrompt(originalTask);

    assert.ok(prompt.includes(originalTask), 'Prompt must include original task description');
    assert.ok(prompt.includes('ORIGINAL TASK DESCRIPTION'), 'Prompt must emphasize using original task');
    assert.ok(prompt.includes("not the worker's summary"), 'Prompt must warn against using worker summary');
});

test('buildConfirmPrompt includes all 5 review dimensions', () => {
    const originalTask = 'Add logging to API endpoints';
    const prompt = buildConfirmPrompt(originalTask);

    assert.ok(prompt.includes('Code Quality'), 'Must include Code Quality dimension');
    assert.ok(prompt.includes('Design Flaws'), 'Must include Design Flaws dimension');
    assert.ok(prompt.includes('Security Vulnerabilities'), 'Must include Security Vulnerabilities dimension');
    assert.ok(prompt.includes('User Experience'), 'Must include User Experience dimension');
    assert.ok(prompt.includes('Goal Completeness'), 'Must include Goal Completeness dimension');
});

test('buildConfirmPrompt mentions confirm() and return_work()', () => {
    const originalTask = 'Refactor database connection pool';
    const prompt = buildConfirmPrompt(originalTask);

    assert.ok(prompt.includes('confirm('), 'Must mention confirm() tool');
    assert.ok(prompt.includes('return_work('), 'Must mention return_work() tool');
    assert.ok(prompt.includes('comment?: string'), 'Must show confirm signature with optional comment');
    assert.ok(prompt.includes('summary: string'), 'Must show return_work signature with summary');
    assert.ok(prompt.includes('affected_files: string[]'), 'Must show return_work signature with affected_files');
});

test('buildConfirmPrompt emphasizes catching hallucinations and omissions', () => {
    const originalTask = 'Fix memory leak in event emitter';
    const prompt = buildConfirmPrompt(originalTask);

    assert.ok(prompt.includes('hallucinations or omissions'), 'Must warn about hallucinations and omissions');
});

test('buildConfirmPrompt instructs re-submission when changes needed', () => {
    const originalTask = 'Update API documentation';
    const prompt = buildConfirmPrompt(originalTask);

    assert.ok(prompt.includes('If anything needs to change'), 'Must provide guidance for when changes are needed');
    assert.ok(prompt.includes('re-submit'), 'Must mention re-submission process');
});
