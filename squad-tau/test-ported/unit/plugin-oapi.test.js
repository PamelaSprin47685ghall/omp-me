import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import squadPlugin, { _resetSquadState } from '../../server/plugin.js';
import { EventLog } from '../../server/event-log.js';
import {
    EffectHandlers,
    _setTestSession,
    _clearTestSession,
    _getSessionStore,
    _getWorkerSessionOptions,
    handleToolEnd,
} from '../../server/side-effects.js';
import { getInitialState } from '../../shared/projections.js';
import { assertAgentToolResult, assertNeverThrows } from '../helpers/contract-validator.js';

function mockPi() {
    const tools = [];
    const commands = [];
    let activeToolNames = [];
    return {
        tools,
        commands,
        registerTool: (def) => tools.push(def),
        on: () => {},
        sendMessage: () => {},
        registerCommand: (name, opts) => commands.push({ name, ...opts }),
        getActiveTools: () => activeToolNames,
        setActiveTools: (names) => {
            activeToolNames = names;
        },
        getThinkingLevel: () => undefined,
    };
}

function activateSquadForTest(pi, ctx) {
    const cmd = pi.commands.find((c) => c.name === 'squad');
    if (cmd) {
        cmd.handler('write hello', ctx);
        return true;
    }
    return false;
}

describe('squad_delegate tool AgentToolResult compliance', () => {
    test('execute returns structured error on missing plan_dir', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        const ctx = { sessionManager: { getSessionId: () => 'test-session' }, ui: { notify: () => {} } };
        activateSquadForTest(pi, ctx);

        // 必须返回 isError，绝不能抛出异常
        const result = await assertNeverThrows(() =>
            tool.execute('call-1', { plan_dir: '/nonexistent/dir' }, undefined, undefined, ctx),
        );
        assertAgentToolResult(result);
        expect(result.isError).toBe(true);
    });

    test('execute returns structured error on invalid TOML', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-oapi-'));
        try {
            fs.writeFileSync(path.join(tmpDir, 'n1.toml'), 'invalid = [\n');
            const ctx = { sessionManager: { getSessionId: () => 'test-session' }, ui: { notify: () => {} } };
            activateSquadForTest(pi, ctx);

            const result = await assertNeverThrows(() =>
                tool.execute('call-2', { plan_dir: tmpDir }, undefined, undefined, ctx),
            );
            assertAgentToolResult(result);
            expect(result.isError).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('execute returns structured error on cycle validation', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        const tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.omp', 'squad', 'plans', 'oapi-cycle-'));
        try {
            fs.writeFileSync(path.join(tmpDir, 'n1.toml'), 'task="1"\ndepends_on=["n2"]\n');
            fs.writeFileSync(path.join(tmpDir, 'n2.toml'), 'task="2"\ndepends_on=["n1"]\n');
            const ctx = { sessionManager: { getSessionId: () => 'test-session' }, ui: { notify: () => {} } };
            activateSquadForTest(pi, ctx);

            const result = await assertNeverThrows(() =>
                tool.execute('call-5', { plan_dir: tmpDir }, undefined, undefined, ctx),
            );
            assertAgentToolResult(result);
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toMatch(/cyclic/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('buildSessionOptions filter regression', () => {
    test('filters squad_delegate and return from worker session tools', () => {
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['squad_delegate', 'read', 'write', 'return'],
        };
        const opts = _getWorkerSessionOptions(pi, 'authoring');
        expect(opts.toolNames).not.toContain('squad_delegate');
        expect(opts.toolNames).not.toContain('return');
        expect(opts.toolNames).toContain('read');
    });

    test('reviewing phase gets restricted tool set', () => {
        const pi = { getThinkingLevel: () => undefined, getActiveTools: () => ['read', 'write', 'edit', 'bash'] };
        const opts = _getWorkerSessionOptions(pi, 'reviewing');
        expect(opts.toolNames).toEqual(['read', 'search', 'find', 'lsp', 'bash']);
    });
});

describe('SideEffect Handler Await & Session Regressions', () => {
    beforeEach(() => _clearTestSession());
    afterEach(() => _clearTestSession());

    test('session:prompting awaits session.prompt() before resolving', async () => {
        let promptCalled = false;
        let promptResolve;
        const promptPromise = new Promise((r) => {
            promptResolve = r;
        });

        _setTestSession('s1', {
            session: {
                prompt: async () => {
                    promptCalled = true;
                    await promptPromise;
                },
            },
            status: 'active',
        });

        const handlerPromise = EffectHandlers['session:prompting'](
            { sessionId: 's1', phase: 'authoring', nodeId: 'n1', promptText: 'test' },
            {
                broadcast: null,
                getState: () => ({ squad: { nodes: {} }, sessions: {} }),
                eventLog: { append: () => {} },
            },
        );

        await new Promise((r) => setTimeout(r, 0));
        expect(promptCalled).toBe(true);

        let resolved = false;
        handlerPromise.then(() => {
            resolved = true;
        });
        await new Promise((r) => setTimeout(r, 5));
        expect(resolved).toBe(false);

        promptResolve();
        await handlerPromise;
        expect(resolved).toBe(true);
    });

    test('squad:abort / squad:complete calls abort() on each active session', async () => {
        const aborted = [];
        _setTestSession('s1', { session: { abort: () => aborted.push('s1') }, status: 'active' });

        await EffectHandlers['squad:abort']({ reason: 'test' }, {});
        expect(aborted).toEqual(['s1']);
        expect(_getSessionStore().size).toBe(0);
    });

    test('handleToolEnd utilizes O(1) toolCalls mapping', async () => {
        const state = {
            toolCalls: {
                'c-123': {
                    toolId: 'c-123',
                    sessionId: 'sx',
                    toolName: 'return',
                    params: { status: 'ok', reason: 'done' },
                },
            },
            sessions: { sx: { sessionId: 'sx', nodeId: 'n1', phase: 'authoring', epoch: 0 } },
            squad: { nodes: { n1: { id: 'n1', epoch: 0 } } },
        };
        const eventLog = new EventLog();
        await handleToolEnd(
            { toolCallId: 'c-123', toolName: 'return', result: { status: 'ok', reason: 'done' }, isError: false },
            { eventLog, sessionId: 'sx', getState: () => state },
        );

        expect(eventLog.log.find((e) => e.event === 'tool_call:finished')).toBeDefined();
        expect(eventLog.log.find((e) => e.event === 'node:work_submitted')).toBeDefined();
    });
});
