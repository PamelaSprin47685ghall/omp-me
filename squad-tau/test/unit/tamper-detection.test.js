import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { captureFileSnapshots, filesChanged } from '../../server/tamper-detection.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('tamper-detection', () => {
    let tmpDir;
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tamper-test-'));
    });
    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    test('captureFileSnapshots captures mtime correctly', async () => {
        const f1 = path.join(tmpDir, 'a.txt'),
            f2 = path.join(tmpDir, 'b.txt');
        await fs.writeFile(f1, 'x');
        await fs.writeFile(f2, 'y');
        const snaps = await captureFileSnapshots(['a.txt', 'b.txt'], tmpDir);
        expect(snaps.size).toBe(2);
        expect(snaps.has(f1)).toBe(true);
        expect(snaps.has(f2)).toBe(true);
        expect(typeof snaps.get(f1)).toBe('number');
        expect(snaps.get(f1)).toBeGreaterThan(0);
    });

    test('filesChanged detects modified file', async () => {
        const f = path.join(tmpDir, 'a.txt');
        await fs.writeFile(f, 'original');
        const snaps = await captureFileSnapshots(['a.txt'], tmpDir);
        await new Promise((r) => setTimeout(r, 10));
        await fs.writeFile(f, 'modified');
        expect(await filesChanged(snaps, tmpDir)).toEqual([f]);
    });

    test('filesChanged detects deleted file', async () => {
        const f = path.join(tmpDir, 'a.txt');
        await fs.writeFile(f, 'content');
        const snaps = await captureFileSnapshots(['a.txt'], tmpDir);
        await fs.unlink(f);
        expect(await filesChanged(snaps, tmpDir)).toEqual([f]);
    });

    test('no changes returns empty array', async () => {
        const f1 = path.join(tmpDir, 'a.txt'),
            f2 = path.join(tmpDir, 'b.txt');
        await fs.writeFile(f1, 'x');
        await fs.writeFile(f2, 'y');
        const snaps = await captureFileSnapshots(['a.txt', 'b.txt'], tmpDir);
        expect(await filesChanged(snaps, tmpDir)).toEqual([]);
    });
});
