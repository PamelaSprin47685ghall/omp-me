import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupRpc, rpcSend, rpcRead, waitForResponse, teardownRpc } from '../helpers/rpc-tmux.js';

function parseJsonl(text) {
    return text
        .split('\n')
        .filter((l) => l.trim().startsWith('{'))
        .map((l) => {
            try {
                return JSON.parse(l);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

describe('OMP RPC E2E', () => {
    beforeEach(async () => {
        await setupRpc();
    });
    afterEach(async () => {
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
            const commandId = '3';
            await rpcSend(
                JSON.stringify({
                    id: commandId,
                    type: 'prompt',
                    message: '/squad M write a hello world function in js',
                }),
            );

            let resp = null;
            let agentStart = null;
            const seen = new Set();
            for (let i = 0; i < 200; i++) {
                const text = await rpcRead();
                const objs = parseJsonl(text);
                for (const obj of objs) {
                    const key = JSON.stringify(obj);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (obj.type === 'response' && obj.id === commandId) resp = obj;
                    if (obj.type === 'agent_start') agentStart = obj;
                }
                if (resp && agentStart) break;
                await Bun.sleep(500);
            }
            expect(resp).not.toBeNull();
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('prompt');
            expect(agentStart).not.toBeNull();

            let toolExec = null;
            const seen2 = new Set(seen);
            for (let i = 0; i < 100; i++) {
                const text = await rpcRead();
                const objs = parseJsonl(text);
                for (const obj of objs) {
                    const key = JSON.stringify(obj);
                    if (seen2.has(key)) continue;
                    seen2.add(key);
                    if (obj.type === 'tool_execution_start') toolExec = obj;
                }
                if (toolExec) break;
                await Bun.sleep(500);
            }
            expect(toolExec).not.toBeNull();
            expect(typeof toolExec.toolName).toBe('string');
        },
        { timeout: 120_000 },
    );

    test(
        'L mode squad',
        async () => {
            const commandId = '4';
            await rpcSend(
                JSON.stringify({
                    id: commandId,
                    type: 'prompt',
                    message: '/squad L node1: write a foo, node2(deps:node1): write a bar',
                }),
            );

            let resp = null;
            const seen = new Set();
            for (let i = 0; i < 200; i++) {
                const text = await rpcRead();
                const objs = parseJsonl(text);
                for (const obj of objs) {
                    const key = JSON.stringify(obj);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (obj.type === 'response' && obj.id === commandId) resp = obj;
                }
                if (resp) break;
                await Bun.sleep(500);
            }
            expect(resp).not.toBeNull();
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('prompt');

            const turnEnds = [];
            for (let i = 0; i < 200; i++) {
                const text = await rpcRead();
                const objs = parseJsonl(text);
                for (const o of objs) {
                    if (o.type === 'turn_end') turnEnds.push(o);
                }
                if (turnEnds.length >= 2) break;
                await Bun.sleep(1000);
            }
            expect(turnEnds.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 180_000 },
    );

    test(
        'bash command returns result with output and exitCode',
        async () => {
            await rpcSend(JSON.stringify({ id: '4', type: 'get_state' }));
            await waitForResponse('4', 30_000);
            await Bun.sleep(2000);
            await rpcSend(JSON.stringify({ id: '5', type: 'bash', command: 'echo hello-rpc-e2e' }));
            const resp = await waitForResponse('5', 30_000);
            expect(resp.success).toBe(true);
            expect(resp.command).toBe('bash');
            expect(typeof resp.data.exitCode).toBe('number');
            expect(resp.data.exitCode).toBe(0);
            expect(resp.data.output).toContain('hello-rpc-e2e');
        },
        { timeout: 90_000 },
    );
});
