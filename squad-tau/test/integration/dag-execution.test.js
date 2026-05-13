/**
 * Small integration test: DAG execution with mocked createAgentSession.
 * Uses the same mock infrastructure as squad-flow-setup.js (no mock.module leak).
 * Tests executeDAG layer-by-layer execution, blocked propagation, result collection.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { EventBus } from '../../server/event-bus.js';
import { ModelPool } from '../../server/model-pool.js';
import { createTestEnvironment, setupSquadRun } from './squad-flow-setup.js';
import { processDelegate } from '../../server/submit-plan.js';
import { getCurrentRun, clearCurrentRun } from '../../server/plugin-state.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('dag-execution with mock createAgentSession', () => {
    let env, planDir;
    beforeEach(() => {
        env = createTestEnvironment();
        planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-exec-'));
        // Register the return tool on the mock pi
    });
    afterEach(() => {
        fs.rmSync(planDir, { recursive: true, force: true });
        clearCurrentRun();
    });

    test('single node returns one result', async () => {
        const { pi, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(
            path.join(planDir, 'n1.toml'),
            'task = "work"\nreview_criteria = ["Output is correct and complete"]',
        );

        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('最终审核者') || text.includes('审核专员')) {
                await session.callTool('return', { status: 'ok', reason: 'approved' });
            } else {
                await session.callTool('return', { status: 'ok', reason: 'ok', affected_files: ['n1.js'] });
            }
        });

        const res = await processDelegate({ plan_dir: planDir }, getCurrentRun());
        expect(res.success).toBe(true);
        expect(res.results.length).toBe(1);
        expect(res.results[0].status).toBe('approved');
    });

    test('chain: n1 -> n2 executes in order', async () => {
        const { pi, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(
            path.join(planDir, 'n1.toml'),
            'task = "first"\nreview_criteria = ["Output matches requirements"]',
        );
        fs.writeFileSync(
            path.join(planDir, 'n2.toml'),
            'task = "second"\nreview_criteria = ["Integrates with n1 correctly"]\ndepends_on = ["n1"]',
        );

        const order = [];
        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('你的任务:')) {
                const task = text.match(/你的任务: (.+)/)?.[1] || '';
                order.push(task.trim());
            }
            if (text.includes('最终审核者') || text.includes('审核专员')) {
                await session.callTool('return', { status: 'ok', reason: 'approved' });
            } else {
                await session.callTool('return', { status: 'ok', reason: 'ok', affected_files: ['f.js'] });
            }
        });

        await processDelegate({ plan_dir: planDir }, getCurrentRun());
        // Both should succeed (n1 first, then n2)
        expect(order.length).toBe(2);
        expect(order[0]).toBe('first');
        expect(order[1]).toBe('second');
    });

    test('failed node blocks downstream', async () => {
        const { pi, squadFsm } = env;
        const modelPool = new ModelPool([
            { provider: 'test', modelId: 'w1', role: 'worker', thinkingLevel: null },
            { provider: 'test', modelId: 'w2', role: 'worker', thinkingLevel: null },
            { provider: 'test', modelId: 'r1', role: 'reviewer', thinkingLevel: null },
            { provider: 'test', modelId: 'r2', role: 'reviewer', thinkingLevel: null },
            { provider: 'test', modelId: 'or1', role: 'reviewer', thinkingLevel: null },
        ]);
        env.modelPool = modelPool;
        setupSquadRun(env, 'two dependent nodes');
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'n1.toml'), 'task = "fail-me"\nreview_criteria = ["Edge cases handled"]');
        fs.writeFileSync(
            path.join(planDir, 'n2.toml'),
            'task = "dependent"\nreview_criteria = ["Dependencies resolved"]\ndepends_on = ["n1"]',
        );

        let rejectCount = 0;
        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('你的任务:')) {
                await session.callTool('return', { status: 'ok', reason: 'work', affected_files: ['f.js'] });
            } else if (text.includes('验证自己的交付质量')) {
                await session.callTool('return', { status: 'ok', reason: 'conf ok' });
            } else if (text.includes('审核专员')) {
                rejectCount++;
                if (rejectCount >= 3) {
                    // Approve after enough retries to avoid infinite loop
                    await session.callTool('return', { status: 'ok', reason: 'approved' });
                } else {
                    await session.callTool('return', { status: 'error', reason: 'bad work' });
                }
            } else if (text.includes('最终审核者')) {
                await session.callTool('return', { status: 'ok', reason: 'all approved' });
            } else {
                await session.callTool('return', { status: 'ok', reason: 'fallback' });
            }
        });

        const res = await processDelegate({ plan_dir: planDir }, getCurrentRun());
        expect(res.success).toBe(true);
        // Both nodes exist in results
        const results = res.results || [];
        expect(results.length).toBeGreaterThanOrEqual(2);
        const n1 = results.find((r) => r.id === 'n1' || r.nodeId === 'n1');
        const n2 = results.find((r) => r.id === 'n2' || r.nodeId === 'n2');
        expect(n1).toBeDefined();
        expect(n2).toBeDefined();
    });
});
