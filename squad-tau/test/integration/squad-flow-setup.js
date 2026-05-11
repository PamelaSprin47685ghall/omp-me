import { stubPi } from '../helpers/mock-pi.js';
import { EventBus } from '../../server/event-bus.js';
import { ModelPool } from '../../server/model-pool.js';
import SquadFSM from '../../server/squad-fsm.js';
import * as sessionRegistry from '../../server/session-registry.js';
import { setCurrentRun, clearCurrentRun } from '../../server/plugin-state.js';
import { executeDAG } from '../../server/dag-execute.js';
import { mock } from 'bun:test';
// Mock getCodingAgentModule while preserving other functionality
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
                    return {
                        cwd,
                        getSessionFile: () => id,
                    };
                },
            },
        }),
    };
});

export function createTestEnvironment() {
    const pi = stubPi();
    const eventBus = new EventBus();
    const modelPool = new ModelPool([
        { provider: 'test', modelId: 'worker-1', role: 'worker', thinkingLevel: null },
        { provider: 'test', modelId: 'worker-2', role: 'worker', thinkingLevel: null },
        { provider: 'test', modelId: 'reviewer-1', role: 'reviewer', thinkingLevel: null },
    ]);
    const squadFsm = new SquadFSM();
    const abortController = new AbortController();
    const signal = abortController.signal;

    return {
        pi,
        eventBus,
        modelPool,
        squadFsm,
        sessionRegistry,
        signal,
        abortController,
    };
}

export function setupSquadRun(env, originalTask = 'test task') {
    const run = {
        fsm: env.squadFsm,
        ctx: { cwd: '.', model: 'test-model', sendMessage: () => {} },
        pi: env.pi,
        signal: env.signal,
        eventBus: env.eventBus,
        modelPool: env.modelPool,
        originalTask,
        startTime: Date.now(),
        abortController: env.abortController,
        executeDAG: async ({ nodes }) =>
            executeDAG({
                nodes,
                ctx: { cwd: '.' },
                pi: env.pi,
                signal: env.signal,
                eventBus: env.eventBus,
                modelPool: env.modelPool,
            }),
        onComplete: ({ results, mode, nodes, durationMs }) => {
            if (env.eventBus) env.eventBus.emit('squad', 'complete', { results, durationMs });
            env.squadFsm.deactivate();
        },
    };
    setCurrentRun(run);
    return run;
}

export function mockAgentBehavior(session, behaviors) {
    session.onPrompt(async (text) => {
        for (const behavior of behaviors) {
            if (behavior.trigger(text)) {
                await behavior.action(session);
                return;
            }
        }
    });
}
