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

    it('should not throw when ctx.args is undefined', async () => {
        const squadCmd = pi._commandRegistry.find((c) => c.name === 'squad');
        const ctx = {
            args: undefined,
            sendMessage: vi.fn(),
        };

        await squadCmd.opts.handler(ctx);

        expect(ctx.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Usage: /squad'));
    });

    it('should not throw when ctx.args is an empty array', async () => {
        const squadCmd = pi._commandRegistry.find((c) => c.name === 'squad');
        const ctx = {
            args: [],
            sendMessage: vi.fn(),
        };

        await squadCmd.opts.handler(ctx);
        expect(ctx.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Usage: /squad'));
    });
});
