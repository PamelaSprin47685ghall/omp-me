import { test, expect } from 'bun:test';
import { buildConfirmPrompt } from '../../server/run-worker-prompt.js';

test('buildConfirmPrompt uses original task not worker summary', () => {
    const originalTask = 'Implement user authentication with JWT tokens';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes(originalTask)).toBeTruthy();
    expect(prompt.includes('ORIGINAL TASK DESCRIPTION')).toBeTruthy();
    expect(prompt.includes("not the worker's summary")).toBeTruthy();
});

test('buildConfirmPrompt includes all 5 review dimensions', () => {
    const originalTask = 'Add logging to API endpoints';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes('Code Quality')).toBeTruthy();
    expect(prompt.includes('Design Flaws')).toBeTruthy();
    expect(prompt.includes('Security Vulnerabilities')).toBeTruthy();
    expect(prompt.includes('User Experience')).toBeTruthy();
    expect(prompt.includes('Goal Completeness')).toBeTruthy();
});

test('buildConfirmPrompt mentions return tool', () => {
    const originalTask = 'Refactor database connection pool';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes('return(')).toBeTruthy();
    expect(prompt.includes("status: 'ok'")).toBeTruthy();
    expect(prompt.includes("status: 'error'")).toBeTruthy();
});

test('buildConfirmPrompt emphasizes catching hallucinations and omissions', () => {
    const originalTask = 'Fix memory leak in event emitter';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes('hallucinations or omissions')).toBeTruthy();
});

test('buildConfirmPrompt instructs re-submission when changes needed', () => {
    const originalTask = 'Update API documentation';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes('If anything needs fixing') || prompt.includes("status: 'error'")).toBeTruthy();
    expect(prompt.includes('re-submit')).toBeTruthy();
});
