import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { setupRpc, rpcSend, waitForResponse, waitForMatch, teardownRpc } from '../helpers/rpc-tmux.js';
import { EventLog } from '../../server/event-log.js';
import { processDelegate } from '../../server/submit-plan.js';
import squadPlugin from '../../server/plugin.js';
import { project } from '../../shared/projections.js';
import { timeTravel, initSquad } from '../helpers/engine-simulator.js';

describe('OMP RPC E2E', () => {
    beforeAll(async () => {
        // One shared RPC session for real-OMP tests
        await setupRpc();
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
        'M mode squad via plugin mock',
        async () => {
            // 1. Plugin registration
            const registeredTools = [];
            const mockPi = {
                registerTool: (name, def) => registeredTools.push({ name, def }),
                on: () => {},
            };
            const plugin = squadPlugin(mockPi);
            expect(plugin.name).toBe('squad-tau');
            expect(plugin.tools).toHaveLength(1);
            expect(plugin.tools[0].name).toBe('squad_delegate');
            expect(typeof plugin.tools[0].handler).toBe('function');
            expect(typeof plugin.onStart).toBe('function');

            // 2. processDelegate with real EventLog + TOML files
            const eventLog = new EventLog();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-mock-m-'));
            try {
                fs.writeFileSync(
                    path.join(tmpDir, 'n1.toml'),
                    'task = "write a hello world function in js"\n' +
                        'depends_on = []\n' +
                        '[[review_criteria]]\n' +
                        'name = "compiles"\n' +
                        'description = "code compiles without errors"\n',
                );

                const result = await processDelegate(
                    { plan_dir: tmpDir },
                    { eventLog, originalTask: 'write hello world', signal: null },
                );
                expect(result.success).toBe(true);

                const last = eventLog.log[eventLog.log.length - 1];
                expect(last.event).toBe('squad:init');
                expect(last.payload.mode).toBe('M');
                expect(last.payload.nodes).toHaveLength(1);
                expect(last.payload.nodes[0].id).toBe('n1');
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }

            // 3. Engine simulation via timeTravel
            const log = timeTravel(
                initSquad({
                    mode: 'M',
                    nodes: [{ id: 'n1', task: 'write hello', review_criteria: ['ok'], depends_on: [] }],
                    originalTask: 'test M',
                }),
            );
            const state = project(log);
            expect(state.squad.status).toBe('complete');
            expect(Object.values(state.squad.nodes).every((n) => n.status === 'approved')).toBe(true);

            // SQUAD_COMPLETE must be the last event
            expect(log[log.length - 1].event).toBe('squad:complete');
        },
        { timeout: 10_000 },
    );

    test(
        'L mode squad via engine simulation',
        async () => {
            // Use timeTravel to simulate L mode with dependency chain
            const log = timeTravel(
                initSquad({
                    mode: 'L',
                    nodes: [
                        { id: 'node1', task: 'write a hello', review_criteria: ['ok'], depends_on: [] },
                        { id: 'node2', task: 'write a world', review_criteria: ['ok'], depends_on: ['node1'] },
                    ],
                    originalTask: 'test L mode',
                }),
            );

            const state = project(log);
            expect(state.squad.status).toBe('complete');
            expect(state.squad.nodes['node1'].status).toBe('approved');
            expect(state.squad.nodes['node2'].status).toBe('approved');

            // Ordering invariant: node1 progresses before node2
            // Phase transitions via node:work_submitted (not squad:node_state)
            const n1Work = log.findIndex((e) => e.event === 'node:work_submitted' && e.payload.nodeId === 'node1');
            const n2Work = log.findIndex((e) => e.event === 'node:work_submitted' && e.payload.nodeId === 'node2');
            expect(n1Work).not.toBe(-1);
            expect(n2Work).not.toBe(-1);
            expect(n2Work).toBeGreaterThan(n1Work);

            // Both nodes produced a final result
            expect(state.squad.nodes['node1'].summary).toBeDefined();
            expect(state.squad.nodes['node2'].summary).toBeDefined();
        },
        { timeout: 10_000 },
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
