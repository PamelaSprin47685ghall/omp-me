import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { start, send, waitForResponse, stop, isOmpAvailable } from '../helpers/rpc-bridge.js';

describe('OMP RPC Physical E2E', () => {
    let _canRun = false;

    beforeAll(async () => {
        if (!isOmpAvailable()) {
            console.log('⚠ omp not found on PATH — skipping RPC E2E tests');
            return;
        }
        try {
            await start(undefined, 30000);
            _canRun = true;
        } catch (err) {
            console.log('⚠ OMP RPC start failed: ' + err.message);
        }
    }, 35000);

    afterAll(async () => {
        try {
            await stop();
        } catch {}
    });

    test('get_state returns valid session state', async () => {
        if (!_canRun) return;
        await send({ id: '1', type: 'get_state' });
        const resp = await waitForResponse('1', 30000);
        expect(resp.success).toBe(true);
        expect(resp.command).toBe('get_state');
        expect(resp.data.model).toBeDefined();
        expect(typeof resp.data.model.id).toBe('string');
    }, 40000);

    test('get_available_models returns model list', async () => {
        if (!_canRun) return;
        await send({ id: '2', type: 'get_available_models' });
        const resp = await waitForResponse('2', 30000);
        expect(resp.success).toBe(true);
        expect(resp.command).toBe('get_available_models');
        expect(Array.isArray(resp.data.models)).toBe(true);
        expect(resp.data.models.length).toBeGreaterThan(0);
    }, 40000);

    test('bash command returns result with output and exitCode', async () => {
        if (!_canRun) return;
        await send({ id: '5', type: 'bash', command: 'echo hello-rpc-e2e' });
        const resp = await waitForResponse('5', 30000);
        expect(resp.success).toBe(true);
        expect(resp.command).toBe('bash');
        expect(typeof resp.data.exitCode).toBe('number');
        expect(resp.data.exitCode).toBe(0);
        expect(resp.data.output).toContain('hello-rpc-e2e');
    }, 40000);
});
