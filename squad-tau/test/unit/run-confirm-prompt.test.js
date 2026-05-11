import { test, expect } from 'bun:test';
import { buildConfirmPrompt } from '../../server/run-worker-prompt.js';

test('buildConfirmPrompt uses original task not worker summary', () => {
    const originalTask = 'Implement user authentication with JWT tokens';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes(originalTask)).toBeTruthy();
    expect(prompt.includes('原始任务')).toBeTruthy();
    expect(prompt.includes('不要依赖你自己之前提交的摘要')).toBeTruthy();
});

test('buildConfirmPrompt includes all 4 review dimensions from AGENTS.md', () => {
    const originalTask = 'Add logging to API endpoints';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes('代码质量')).toBeTruthy();
    expect(prompt.includes('设计缺陷')).toBeTruthy();
    expect(prompt.includes('用户体验')).toBeTruthy();
    expect(prompt.includes('目标完整性')).toBeTruthy();
});

test('buildConfirmPrompt mentions return tool', () => {
    const originalTask = 'Refactor database connection pool';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes('return({ status: "ok", reason, affected_files })')).toBeTruthy();
});

test('buildConfirmPrompt emphasizes original task over summary', () => {
    const originalTask = 'Fix memory leak in event emitter';
    const prompt = buildConfirmPrompt(originalTask);

    expect(prompt.includes('避免幻觉和遗漏')).toBeTruthy();
});

test('buildConfirmPrompt includes review_criteria when present', () => {
    const node = {
        task: 'Update API documentation',
        review_criteria: [{ name: 'Criterion A', description: 'Must work' }],
    };
    const prompt = buildConfirmPrompt(node);

    expect(prompt.includes('评审标准')).toBeTruthy();
    expect(prompt.includes('Criterion A')).toBeTruthy();
    expect(prompt.includes('Must work')).toBeTruthy();
});
