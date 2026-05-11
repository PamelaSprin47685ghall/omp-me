import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
    setupRpc,
    rpcSend,
    waitForResponse,
    waitForMatch,
    teardownRpc,
    isSquadTauLoaded,
} from '../helpers/rpc-tmux.js';

describe('OMP RPC E2E', () => {
    let squadLoaded = false;

    beforeAll(async () => {
        // One shared RPC session for all tests
        await setupRpc();
        squadLoaded = await isSquadTauLoaded();
    }, 20_000);

    afterAll(async () => {
        await teardownRpc();
    });

    test(
        'get_state returns valid session state',
        async () => {
            await rpcSend(JSON.stringify({ id: '1', type: 'get_state' }));
            const resp = await waitForResponse('1', 30_000);
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('get_state');
            expect(resp.data.model).toBeDefined();
            expect(typeof resp.data.model.id).toBe('string');
        },
        { timeout: 60_000 },
    );

    test(
        'get_available_models returns model list',
        async () => {
            await rpcSend(JSON.stringify({ id: '2', type: 'get_available_models' }));
            const resp = await waitForResponse('2', 30_000);
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('get_available_models');
            expect(Array.isArray(resp.data.models)).toBe(true);
            expect(resp.data.models.length).toBeGreaterThan(0);
            expect(typeof resp.data.models[0].id).toBe('string');
        },
        { timeout: 60_000 },
    );

    test(
        'M mode squad via prompt with async event flow',
        async () => {
            if (!squadLoaded) {
                console.log('Skipping Squad M test: squad-tau plugin not loaded');
                return;
            }
            const commandId = '3';
            await rpcSend(
                JSON.stringify({
                    id: commandId,
                    type: 'prompt',
                    message: '/squad M write a hello world function in js',
                }),
            );

            const resp = await waitForMatch(
                (obj) => (obj.type === 'response' && obj.id === commandId ? obj : undefined),
                30000,
            );
            expect(resp).not.toBeNull();
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('prompt');

            const agentStart = await waitForMatch((obj) => (obj.type === 'agent_start' ? obj : undefined), 10000);
            expect(agentStart).not.toBeNull();

            const toolExec = await waitForMatch(
                (obj) => (obj.type === 'tool_execution_start' ? obj : undefined),
                15000,
            );
            expect(toolExec).not.toBeNull();
            expect(typeof toolExec.toolName).toBe('string');
        },
        { timeout: 60_000 },
    );

    test(
        'L mode squad',
        async () => {
            if (!squadLoaded) {
                console.log('Skipping Squad L test: squad-tau plugin not loaded');
                return;
            }
            const commandId = '4';
            await rpcSend(
                JSON.stringify({
                    id: commandId,
                    type: 'prompt',
                    message: '/squad L node1: write a hello, node2(deps:node1): write a world',
                }),
            );

            const resp = await waitForMatch(
                (obj) => (obj.type === 'response' && obj.id === commandId ? obj : undefined),
                30000,
            );
            expect(resp).not.toBeNull();
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('prompt');

            const turnEnds = [];
            while (turnEnds.length < 2) {
                const ev = await waitForMatch((obj) => (obj.type === 'turn_end' ? obj : undefined), 60000);
                if (ev) turnEnds.push(ev);
            }
            expect(turnEnds.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 120_000 },
    );

    test(
        'bash command returns result with output and exitCode',
        async () => {
            await rpcSend(JSON.stringify({ id: '5', type: 'bash', command: 'echo hello-rpc-e2e' }));
            const resp = await waitForResponse('5', 30_000);
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('bash');
            expect(typeof resp.data.exitCode).toBe('number');
            expect(resp.data.exitCode).toBe(0);
            expect(resp.data.output).toContain('hello-rpc-e2e');
        },
        { timeout: 40_000 },
    );
});
