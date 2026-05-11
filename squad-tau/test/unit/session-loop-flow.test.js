import { test, expect, mock } from 'bun:test';
import { runWorker } from '../../server/run-worker.js';
import { runReviewer } from '../../server/run-reviewer.js';
import { stubPi } from '../helpers/mock-pi.js';
import { EventBus } from '../../server/event-bus.js';
import { buildGlobalReturnTool } from '../../server/lifecycle-tools.js';

mock.module('@oh-my-pi/resolve-pi', () => {
    const { createRequire } = require('module');
    const { fileURLToPath } = require('url');
    const { dirname, join } = require('path');

    return {
        requireScoped: (importMetaUrl) => {
            const __filename = fileURLToPath(importMetaUrl);
            return createRequire(join(dirname(__filename), 'noop.js'));
        },
        getCodingAgentModule: async () => ({
            SessionManager: {
                create: (cwd) => {
                    const id = `test-session-${Math.random().toString(36).slice(2)}`;
                    return { cwd, getSessionFile: () => id };
                },
            },
        }),
    };
});

function makeModelPool() {
    const slots = [];
    return {
        acquire: async () => null,
        release: () => {},
        getSlots: () => slots,
    };
}

function instrumentSession(pi) {
    const calls = [];
    const origCreate = pi.pi.createAgentSession;
    pi.pi.createAgentSession = async (opts) => {
        const result = await origCreate(opts);
        const s = result.session;
        const origWaitForIdle = s.waitForIdle;
        s.waitForIdle = () => {
            calls.push('waitForIdle');
            return origWaitForIdle();
        };
        return result;
    };
    return calls;
}

test('runWorker uses waitForIdle after each prompt (no isStreaming polling)', async () => {
    const pi = stubPi();
    pi.registerTool(buildGlobalReturnTool());
    const waitForIdleCalls = instrumentSession(pi);
    const eventBus = new EventBus();

    pi.pi.onPrompt(async (text, session) => {
        if (text.includes('你的任务:')) {
            await session.callTool('return', { status: 'ok', reason: 'phase1', affected_files: [] });
        } else if (text.includes('验证自己的交付质量')) {
            await session.callTool('return', { status: 'ok', reason: 'confirmed' });
        } else {
            await session.callTool('return', { status: 'ok', reason: 'fallback' });
        }
    });

    const result = await runWorker({
        node: { id: 'N1', task: 'test task', review_criteria: ['quality'] },
        ctx: { cwd: '.', sendMessage: () => {}, getActiveTools: () => [] },
        pi,
        signal: new AbortController().signal,
        eventBus,
        modelPool: makeModelPool(),
        modelSlot: null,
    });

    expect(result).not.toBeNull();
    expect(result.reason).toBe('confirmed');
    expect(waitForIdleCalls.length).toBeGreaterThan(0);
});

test('runReviewer uses waitForIdle (no isStreaming polling)', async () => {
    const pi = stubPi();
    pi.registerTool(buildGlobalReturnTool());
    const waitForIdleCalls = instrumentSession(pi);
    const eventBus = new EventBus();

    pi.pi.onPrompt(async (text, session) => {
        if (text.includes('原始任务:')) {
            await session.callTool('return', { status: 'ok', reason: 'approved' });
        } else {
            await session.callTool('return', { status: 'ok', reason: 'fallback' });
        }
    });

    const result = await runReviewer({
        node: { id: 'N1', task: 'test task', review_criteria: ['quality'] },
        workerResult: { reason: 'done', affected_files: [] },
        ctx: { cwd: '.', sendMessage: () => {} },
        pi,
        signal: new AbortController().signal,
        eventBus,
        modelPool: makeModelPool(),
        modelSlot: null,
    });

    expect(result).not.toBeNull();
    expect(result.approved).toBe(true);
    expect(waitForIdleCalls.length).toBeGreaterThan(0);
});

test('startHeartbeat does not use PONG_TIMEOUT or clients.delete', () => {
    const fs = require('fs');
    const source = fs.readFileSync('server/ws-heartbeat.js', 'utf8');
    expect(source.includes('PONG_TIMEOUT')).toBe(false);
    expect(source.includes('clients.delete(ws)')).toBe(false);
});

test('handlePong is not exported from ws-heartbeat', async () => {
    const mod = await import('../../server/ws-heartbeat.js');
    expect(mod.handlePong).toBeUndefined();
});

test('retry-logic.js file does not exist', () => {
    const fs = require('fs');
    expect(fs.existsSync('server/retry-logic.js')).toBe(false);
});
