import { describe, test, expect } from 'bun:test';
import buildConfirmPrompt from '../../server/run-confirm-prompt.js';
import { captureFileSnapshots, filesChanged } from '../../server/tamper-detection.js';
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

    test('instructs to call confirm() or return_work()', () => {
        const prompt = buildConfirmPrompt('Add tests');
        expect(prompt).toContain('confirm(');
        expect(prompt).toContain('return_work(');
    });
});

describe('tamper detection', () => {
    const tmpDir = path.join(os.tmpdir(), 'squad-tau-test-tamper-' + Date.now());

    test('captureFileSnapshots returns empty map for empty file list', async () => {
        const snapshots = await captureFileSnapshots([], process.cwd());
        expect(snapshots.size).toBe(0);
    });

    test('filesChanged returns empty for unchanged files', async () => {
        await fs.mkdir(tmpDir, { recursive: true });
        const testFile = path.join(tmpDir, 'test.txt');
        await fs.writeFile(testFile, 'hello', 'utf8');
        const snapshots = await captureFileSnapshots([testFile], '/');
        const changed = await filesChanged(snapshots, '/');
        expect(changed).toEqual([]);
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    test('filesChanged detects modified files', async () => {
        await fs.mkdir(tmpDir, { recursive: true });
        const testFile = path.join(tmpDir, 'test.txt');
        await fs.writeFile(testFile, 'hello', 'utf8');
        const snapshots = await captureFileSnapshots([testFile], '/');
        // Modify the file
        await new Promise((r) => setTimeout(r, 10));
        await fs.writeFile(testFile, 'modified', 'utf8');
        const changed = await filesChanged(snapshots, '/');
        expect(changed.length).toBeGreaterThan(0);
        expect(changed[0]).toContain('test.txt');
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
