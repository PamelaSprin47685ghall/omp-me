import { describe, test, expect } from 'bun:test';
import { buildConfirmPrompt } from '../../server/run-worker-prompt.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('buildConfirmPrompt', () => {
    test('includes original task description', () => {
        const prompt = buildConfirmPrompt('Fix the login bug');
        expect(prompt).toContain('Fix the login bug');
    });

    test('uses original task description not worker summary as basis', () => {
        const prompt = buildConfirmPrompt('Refactor auth module');
        expect(prompt).toContain('Refactor auth module');
        expect(prompt).toContain('原始任务');
        expect(prompt).toContain('不要依赖你自己之前提交的摘要');
        expect(prompt).toContain('避免幻觉和遗漏');
    });

    test('includes all 4 review dimensions', () => {
        const prompt = buildConfirmPrompt('Implement search');
        const dimensions = ['代码质量', '设计缺陷', '用户体验', '目标完整性'];
        for (const dim of dimensions) {
            expect(prompt).toContain(dim);
        }
    });

    test('instructs to call return() with status ok', () => {
        const prompt = buildConfirmPrompt('Add tests');
        expect(prompt).toContain('return({ status: "ok", reason, affected_files })');
    });
});
