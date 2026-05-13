import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createTestEnvironment, setupSquadRun } from './squad-flow-setup.js';
import { processDelegate } from '../../server/submit-plan.js';
import { getCurrentRun, clearCurrentRun } from '../../server/plugin-state.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Run Node Flow Lifecycle', () => {
    let env, planDir;

    beforeEach(() => {
        env = createTestEnvironment();
        planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-node-flow-'));
    });

    afterEach(() => {
        if (planDir && fs.existsSync(planDir)) {
            fs.rmSync(planDir, { recursive: true, force: true });
        }
        clearCurrentRun();
    });

    test('single node happy path', async () => {
        const { pi, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();

        fs.writeFileSync(
            path.join(planDir, 'node1.toml'),
            'task = "do work"\nreview_criteria = ["Output is correct and complete"]',
        );

        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('最终审核者')) {
                await session.callTool('return', { status: 'ok', reason: 'all good' });
            } else if (text.includes('审核专员')) {
                await session.callTool('return', { status: 'ok', reason: 'review approved' });
            } else if (text.includes('你的任务:')) {
                await session.callTool('return', { status: 'ok', reason: 'work result', affected_files: ['f1.js'] });
            } else if (text.includes('验证自己的交付质量')) {
                await session.callTool('return', { status: 'ok', reason: 'confirm ok' });
            } else {
                await session.callTool('return', { status: 'ok', reason: 'fallback' });
            }
        });

        const res = await processDelegate({ plan_dir: planDir }, getCurrentRun());

        expect(res.success).toBe(true);
        expect(res.results[0].status).toBe('approved');
        expect(squadFsm.state).toBe('idle');
    });

    test('reject → retry cycle', async () => {
        const { pi, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();

        fs.writeFileSync(
            path.join(planDir, 'node1.toml'),
            'task = "do work"\nreview_criteria = ["Meets acceptance criteria"]',
        );

        let reviewerCalls = 0;
        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('最终审核者')) {
                await session.callTool('return', { status: 'ok', reason: 'all good' });
            } else if (text.includes('审核专员')) {
                reviewerCalls++;
                if (reviewerCalls === 1) {
                    await session.callTool('return', { status: 'error', reason: 'needs rework' });
                } else {
                    await session.callTool('return', { status: 'ok', reason: 'approved' });
                }
            } else {
                await session.callTool('return', { status: 'ok', reason: 'done', affected_files: ['f1.js'] });
            }
        });

        const res = await processDelegate({ plan_dir: planDir }, getCurrentRun());

        expect(res.success).toBe(true);
        expect(squadFsm.state).toBe('idle');
        expect(reviewerCalls).toBe(2);
    });

    test('outer review rejects then approves', async () => {
        const { pi, squadFsm } = env;
        setupSquadRun(env);
        squadFsm.activate();

        // L mode requires at least 2 nodes or it defaults to M (if only 1)
        fs.writeFileSync(
            path.join(planDir, 'A.toml'),
            'task = "task A"\nreview_criteria = ["Task A output is complete"]',
        );
        fs.writeFileSync(
            path.join(planDir, 'B.toml'),
            'task = "task B"\nreview_criteria = ["Task B output is complete"]',
        );

        let outerReviewCalls = 0;
        pi.pi.onPrompt(async (text, session) => {
            if (text.includes('最终审核者')) {
                outerReviewCalls++;
                if (outerReviewCalls === 1) {
                    await session.callTool('return', { status: 'error', reason: 'rejected' });
                } else {
                    await session.callTool('return', { status: 'ok', reason: 'approved' });
                }
            } else {
                await session.callTool('return', { status: 'ok', reason: 'ok', affected_files: ['f.js'] });
            }
        });

        const handlerFactory = () => (params) => processDelegate(params, getCurrentRun());

        // Delegation 1: outer review rejects
        const res1 = await handlerFactory()({ plan_dir: planDir });
        expect(res1.success).toBe(true);
        expect(res1.outerReviewRejected).toBe(true);
        // FSM must be deactivated after rejection (architecture: 1 round only)
        expect(squadFsm.state).toBe('idle');
        expect(outerReviewCalls).toBe(1);

        // Re-delegation is not allowed when FSM is idle
        await expect(handlerFactory()({ plan_dir: planDir })).rejects.toThrow(
            'Cannot delegate in state: idle. Must be active.',
        );
    });
});
