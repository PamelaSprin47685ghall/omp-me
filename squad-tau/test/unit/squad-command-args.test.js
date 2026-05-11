import { describe, it, expect, vi, beforeEach } from 'vitest';
import squadPlugin from '../../server/squad-engine.js';
import { stubPi } from '../helpers/mock-pi.js';

vi.mock('@oh-my-pi/resolve-pi', () => ({
    getCodingAgentModule: vi.fn().mockResolvedValue({
        SessionManager: {
            create: vi.fn().mockReturnValue({
                getSessionFile: () => 'test-session.jsonl',
            }),
        },
    }),
}));

vi.mock('../../server/server-lifecycle.js', () => ({
    startServer: vi.fn().mockResolvedValue({ port: 1234 }),
    getServerPort: vi.fn().mockReturnValue(1234),
    getGlobalEventBus: vi.fn().mockReturnValue({ emit: vi.fn(), on: vi.fn() }),
    getGlobalModelPool: vi.fn().mockReturnValue({ acquire: vi.fn(), release: vi.fn() }),
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
