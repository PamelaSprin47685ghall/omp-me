import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupRpc, rpcSend, waitForResponse, teardownRpc } from '../helpers/rpc-tmux.js';

describe('Debug RPC', () => {
    beforeAll(setupRpc, 60_000);
    afterAll(teardownRpc);

    test(
        'get_available with explicit timeout',
        async () => {
            await rpcSend(JSON.stringify({ id: '2', type: 'get_available_models' }));
            const resp = await waitForResponse('2', 30_000);
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('get_available_models');
            expect(Array.isArray(resp.data.models)).toBe(true);
            expect(resp.data.models.length).toBeGreaterThan(0);
        },
        { timeout: 45_000 },
    );
});
