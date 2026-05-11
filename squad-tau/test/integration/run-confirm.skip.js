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
        expect(prompt).toContain('ORIGINAL TASK DESCRIPTION');
        expect(prompt).not.toContain('worker submitted');
    });

    test('includes all 5 review dimensions', () => {
        const prompt = buildConfirmPrompt('Implement search');
        const dimensions = [
            'Code Quality',
            'Design Flaws',
            'Security Vulnerabilities',
            'User Experience',
            'Goal Completeness',
        ];
        for (const dim of dimensions) {
            expect(prompt).toContain(dim);
        }
    });

    test('instructs to call return() with status ok or error', () => {
        const prompt = buildConfirmPrompt('Add tests');
        expect(prompt).toContain('return(');
        expect(prompt).toContain("status: 'ok'");
        expect(prompt).toContain("status: 'error'");
    });
});
