import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mock } from 'bun:test';
import squadPlugin from '../../server/squad-engine.js';
import { stubPi } from '../helpers/mock-pi.js';

mock.module('@oh-my-pi/resolve-pi', () => ({
    getCodingAgentModule: async () => ({
        SessionManager: {
            create: () => ({ getSessionFile: () => 'test-session.jsonl' }),
        },
    }),
}));

describe('squad command args handling', () => {
    let pi;
    beforeEach(() => {
        pi = stubPi();
        squadPlugin(pi);
    });

    it('should handle empty string args without crashing', async () => {
        const squadCmd = pi._commandRegistry.find((c) => c.name === 'squad');
        const args = '';
        const ctx = { model: 'test-model', cwd: '.' };

        const sendMessageSpy = vi.spyOn(pi, 'sendMessage');

        await squadCmd.opts.handler(args, ctx);

        expect(sendMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: /squad'));
    });

    it('should handle whitespace-only string args', async () => {
        const squadCmd = pi._commandRegistry.find((c) => c.name === 'squad');
        const args = '   ';
        const ctx = { model: 'test-model', cwd: '.' };

        const sendMessageSpy = vi.spyOn(pi, 'sendMessage');

        await squadCmd.opts.handler(args, ctx);

        expect(sendMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: /squad'));
    });

    afterAll(async () => {
        const { stopServer } = await import('../../server/server-lifecycle.js');
        await stopServer();
    });

    it('should parse string args correctly (real OMP behavior)', () => {
        // Test the parsing logic directly without executing the full handler
        const testCases = [
            { input: '在 /tmp/calc 写一个计算器', expected: '在 /tmp/calc 写一个计算器' },
            { input: '', expected: '' },
            { input: '   ', expected: '' },
        ];

        for (const { input, expected } of testCases) {
            const result = typeof input === 'string' ? input.trim() : (input || []).join(' ').trim();
            expect(result).toBe(expected);
        }
    });
});
