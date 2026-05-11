import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createTestEnvironment, setupSquadRun } from './squad-flow-setup.js';
import { createDelegateHandler } from '../../server/submit-plan.js';
import { buildGlobalReturnTool } from '../../server/lifecycle-tools.js';
import { getCurrentRun, clearCurrentRun } from '../../server/plugin-state.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Squad Flow - M mode', () => {
    let env, planDir;
    beforeEach(() => {
        env = createTestEnvironment();
        env.pi.registerTool(buildGlobalReturnTool());
        planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-m-'));
    });
    afterEach(() => {
        fs.rmSync(planDir, { recursive: true, force: true });
        clearCurrentRun();
    });

    test('single node delegation', async () => {
        const { pi, eventBus, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'node1.toml'), 'task = "do work"');
        let events = [];
        eventBus.on('squad:*', (data, event) => events.push({ type: event.split(':')[1], data }));
        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('审核专员')) await session.callTool('return', { status: 'ok', reason: 'app' });
            else if (text.includes('你的任务:'))
                await session.callTool('return', { status: 'ok', reason: 'work', affected_files: ['f1.js'] });
            else if (text.includes('验证自己的交付质量'))
                await session.callTool('return', { status: 'ok', reason: 'conf' });
            else if (text.includes('最终审核者')) await session.callTool('return', { status: 'ok', reason: 'all' });
        });
        const res = await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        expect(res.success).toBe(true);
        expect(squadFsm.state).toBe('idle');
        expect(events.some((e) => e.type === 'init')).toBe(true);
        expect(events.some((e) => e.type === 'complete')).toBe(true);
    });
});

describe('Squad Flow - L mode Basic', () => {
    let env, planDir;
    beforeEach(() => {
        env = createTestEnvironment();
        env.pi.registerTool(buildGlobalReturnTool());
        planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-l-'));
    });
    afterEach(() => {
        fs.rmSync(planDir, { recursive: true, force: true });
        clearCurrentRun();
    });

    test('2 parallel nodes', async () => {
        const { pi, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'n1.toml'), 'task = "w1"');
        fs.writeFileSync(path.join(planDir, 'n2.toml'), 'task = "w2"');
        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('审核专员') || text.includes('最终审核者'))
                await session.callTool('return', { status: 'ok', reason: 'ok' });
            else if (text.includes('你的任务:') || text.includes('验证自己的交付质量'))
                await session.callTool('return', { status: 'ok', reason: 'ok' });
        });
        const res = await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        expect(res.success).toBe(true);
        expect(res.results.length).toBe(2);
    });

    test('node1 -> node2 chain', async () => {
        const { pi, squadFsm, eventBus } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'n1.toml'), 'task = "w1"');
        fs.writeFileSync(path.join(planDir, 'n2.toml'), 'task = "w2"\ndepends_on = ["n1"]');
        let times = {};
        eventBus.on('squad:node_state', (data) => {
            if (data.status === 'authoring' && !times[data.nodeId]) times[data.nodeId] = Date.now();
            if (['approved', 'failed', 'blocked'].includes(data.status)) times[data.nodeId + '_e'] = Date.now();
        });
        pi.pi.onPrompt(async (text, session) => {
            await session.callTool('return', { status: 'ok', reason: 'ok' });
        });
        await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        expect(times['n2']).toBeGreaterThanOrEqual(times['n1_e']);
    });
});

describe('Squad Flow - Advanced', () => {
    let env, planDir;
    beforeEach(() => {
        env = createTestEnvironment();
        env.pi.registerTool(buildGlobalReturnTool());
        planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-adv-'));
    });
    afterEach(() => {
        fs.rmSync(planDir, { recursive: true, force: true });
        clearCurrentRun();
    });

    test('diamond: A -> B,C -> D', async () => {
        const { pi, eventBus, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'A.toml'), 'task = "A"');
        fs.writeFileSync(path.join(planDir, 'B.toml'), 'task = "B"\ndepends_on = ["A"]');
        fs.writeFileSync(path.join(planDir, 'C.toml'), 'task = "C"\ndepends_on = ["A"]');
        fs.writeFileSync(path.join(planDir, 'D.toml'), 'task = "D"\ndepends_on = ["B", "C"]');
        let times = {};
        eventBus.on('squad:node_state', (data) => {
            if (data.status === 'authoring' && !times[data.nodeId]) times[data.nodeId] = Date.now();
            if (['approved', 'failed', 'blocked'].includes(data.status)) times[data.nodeId + '_e'] = Date.now();
        });
        pi.pi.onPrompt(async (t, s) => {
            await s.callTool('return', { status: 'ok', reason: 'ok' });
        });
        await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        expect(times['B']).toBeGreaterThanOrEqual(times['A_e']);
        expect(times['C']).toBeGreaterThanOrEqual(times['A_e']);
        expect(times['D']).toBeGreaterThanOrEqual(times['B_e']);
        expect(times['D']).toBeGreaterThanOrEqual(times['C_e']);
    });

    test('abort signal', async () => {
        const { pi, squadFsm, abortController, signal } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'n1.toml'), 'task = "long"');
        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('你的任务:')) abortController.abort();
            try {
                await session.callTool('return', { status: 'ok', reason: 'ok' });
            } catch (e) {}
        });
        try {
            await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        } catch (e) {}
        expect(signal.aborted).toBe(true);
    });
});

describe('Squad Flow - Reject Flow', () => {
    let env, planDir;
    beforeEach(() => {
        env = createTestEnvironment();
        env.pi.registerTool(buildGlobalReturnTool());
        planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-rej-'));
    });
    afterEach(() => {
        fs.rmSync(planDir, { recursive: true, force: true });
        clearCurrentRun();
    });

    test('M mode: reject → retry → approve', async () => {
        const { pi, eventBus, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'n1.toml'), 'task = "do work"');

        let reviewerCalls = 0;
        pi.pi.onPrompt(async (text, session) => {
            // Outer review — approve
            if (text.includes('最终审核者')) {
                await session.callTool('return', { status: 'ok', reason: 'all good' });
                return;
            }
            // Reviewer — reject first call, approve second
            if (text.includes('审核专员')) {
                reviewerCalls++;
                if (reviewerCalls === 1) {
                    await session.callTool('return', { status: 'error', reason: 'needs improvement' });
                } else {
                    await session.callTool('return', { status: 'ok', reason: 'approved' });
                }
                return;
            }
            // Worker / Self-confirm — always ok
            await session.callTool('return', { status: 'ok', reason: 'done', affected_files: ['f.js'] });
        });

        const res = await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        expect(res.success).toBe(true);
        expect(squadFsm.state).toBe('idle');
        expect(reviewerCalls).toBe(2);
    });
});

describe('Squad Flow - Outer Review', () => {
    let env, planDir;
    beforeEach(() => {
        env = createTestEnvironment();
        env.pi.registerTool(buildGlobalReturnTool());
        planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-or-'));
    });
    afterEach(() => {
        fs.rmSync(planDir, { recursive: true, force: true });
        clearCurrentRun();
    });

    test('L mode: outer review reject → active', async () => {
        const { pi, eventBus, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();
        fs.writeFileSync(path.join(planDir, 'A.toml'), 'task = "task A"');
        fs.writeFileSync(path.join(planDir, 'B.toml'), 'task = "task B"');

        let outerReviewCalls = 0;
        pi.pi.onPrompt(async (text, session) => {
            // Outer review (最终审核者) — reject first time
            if (text.includes('最终审核者')) {
                outerReviewCalls++;
                if (outerReviewCalls === 1) {
                    await session.callTool('return', { status: 'error', reason: 'needs rework from outer review' });
                } else {
                    await session.callTool('return', { status: 'ok', reason: 'approved after rework' });
                }
                return;
            }
            // Reviewer (审核专员) — always approve
            if (text.includes('审核专员')) {
                await session.callTool('return', { status: 'ok', reason: 'good work' });
                return;
            }
            // Worker / Self-confirm — always ok
            await session.callTool('return', { status: 'ok', reason: 'done', affected_files: ['f.js'] });
        });

        // First delegation — outer review rejects
        const res = await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        expect(res.success).toBe(true);
        // After outer review reject, FSM should be in 'active' state
        expect(squadFsm.state).toBe('active');
        expect(outerReviewCalls).toBe(1);

        // Re-delegate — outer review approves this time
        const res2 = await createDelegateHandler(getCurrentRun()).handler({ plan_dir: planDir });
        expect(res2.success).toBe(true);
        expect(squadFsm.state).toBe('idle');
        expect(outerReviewCalls).toBe(2);
    });
});
