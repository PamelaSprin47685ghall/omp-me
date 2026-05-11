import { describe, it, expect, vi, beforeEach } from 'vitest';
import squadPlugin from '../../server/squad-engine.js';
import { stubPi } from '../helpers/mock-pi.js';

vi.mock('../../server/server-lifecycle.js', () => ({
    startServer: vi.fn().mockResolvedValue({ port: 1234 }),
    getServerPort: vi.fn().mockReturnValue(1234),
    getGlobalEventBus: vi.fn(),
    getGlobalModelPool: vi.fn(),
}));

describe('squad command args handling', () => {
    let pi;
    beforeEach(() => {
        pi = stubPi();
        squadPlugin(pi);
    });

    it('should handle empty args without crashing', async () => {
        const squadCmd = pi._commandRegistry.find((c) => c.name === 'squad');
        const args = [];
        const ctx = { model: 'test-model', cwd: '.' };

        const sendMessageSpy = vi.spyOn(pi, 'sendMessage');

        await squadCmd.opts.handler(args, ctx);

        expect(sendMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: /squad'));
    });

    it('should handle undefined args without crashing', async () => {
        const squadCmd = pi._commandRegistry.find((c) => c.name === 'squad');
        const args = undefined;
        const ctx = { model: 'test-model', cwd: '.' };

        const sendMessageSpy = vi.spyOn(pi, 'sendMessage');

        await squadCmd.opts.handler(args, ctx);

        expect(sendMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: /squad'));
    });
});
