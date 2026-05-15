/**
 * Regression tests for OMP ExtensionAPI compliance.
 *
 * Verifies that:
 * 1. squad_delegate tool execute handler returns proper AgentToolResult
 *    { content: [...], isError?: boolean } on all paths (never throws)
 * 2. All OMP API calls match the real API signatures
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import squadPlugin, { _resetSquadState, _setTestEventLog, _restoreGlobalEventLog } from '../../server/plugin.js';
import { EventLog } from '../../server/event-log.js';
import { processDelegate } from '../../server/submit-plan.js';
import {
    EffectHandlers,
    _setTestSession,
    _clearTestSession,
    _getWorkerSessionOptions,
} from '../../server/side-effects.js';
import { getInitialState, project, applyEvent } from '../../shared/projections.js';

function mockPi() {
    const tools = [];
    const events = [];
    const commands = [];
    let activeToolNames = [];
    return {
        tools,
        events,
        commands,
        registerTool: (def) => tools.push(def),
        on: (event, handler) => events.push({ event, handler }),
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
    // Call the /squad command handler to set _squadActive = true
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
        expect(tool).toBeDefined();
        expect(typeof tool.execute).toBe('function');

        const ctx = {
            sessionManager: {
                getSessionId: () => 'test-session',
                getSessionFile: () => '/tmp/fake.session',
            },
            ui: { notify: () => {} },
        };

        activateSquadForTest(pi, ctx);

        // Should NOT throw — must return structured error
        let result;
        try {
            result = await tool.execute('call-1', { plan_dir: '/nonexistent/dir' }, undefined, undefined, ctx);
        } catch (e) {
            expect.unreachable('execute must not throw: ' + e.message);
        }

        // AgentToolResult contract: { content: TextContent[], isError?: boolean }
        expect(result).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0]).toMatchObject({ type: 'text' });
        expect(typeof result.content[0].text).toBe('string');
        expect(result.isError).toBe(true);
    });

    test('execute returns structured error on invalid TOML', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-oapi-'));
        try {
            // Create a file with invalid TOML
            fs.writeFileSync(
                path.join(tmpDir, 'n1.toml'),
                'task = "hello"\ndepends_on = [\n[[review_criteria]]\nname = "ok"\n',
            );

            const ctx = {
                sessionManager: {
                    getSessionId: () => 'test-session',
                },
                ui: { notify: () => {} },
            };

            activateSquadForTest(pi, ctx);

            let result;
            try {
                result = await tool.execute('call-2', { plan_dir: tmpDir }, undefined, undefined, ctx);
            } catch (e) {
                expect.unreachable('execute must not throw: ' + e.message);
            }

            expect(result).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content[0]).toMatchObject({ type: 'text' });
            expect(result.isError).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('execute returns AgentToolResult on empty directory', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-oapi-empty-'));
        try {
            const ctx = {
                sessionManager: {
                    getSessionId: () => 'test-session',
                },
                ui: { notify: () => {} },
            };

            activateSquadForTest(pi, ctx);

            let result;
            try {
                result = await tool.execute('call-3', { plan_dir: tmpDir }, undefined, undefined, ctx);
            } catch (e) {
                expect.unreachable('execute must not throw: ' + e.message);
            }

            expect(result).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content[0]).toMatchObject({ type: 'text' });
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

        // Create two nodes with a mutual dependency (cycle)
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-oapi-cycle-'));
        try {
            fs.writeFileSync(
                path.join(tmpDir, 'n1.toml'),
                'task = "write hello"\n' +
                    'depends_on = ["n2"]\n' +
                    '[[review_criteria]]\n' +
                    'name = "works"\n' +
                    'description = "it works"\n',
            );
            fs.writeFileSync(
                path.join(tmpDir, 'n2.toml'),
                'task = "write world"\n' +
                    'depends_on = ["n1"]\n' +
                    '[[review_criteria]]\n' +
                    'name = "works"\n' +
                    'description = "it works"\n',
            );

            const ctx = {
                sessionManager: {
                    getSessionId: () => 'test-session',
                },
                ui: { notify: () => {} },
            };

            activateSquadForTest(pi, ctx);

            let result;
            try {
                result = await tool.execute('call-5', { plan_dir: tmpDir }, undefined, undefined, ctx);
            } catch (e) {
                expect.unreachable('execute must not throw: ' + e.message);
            }

            expect(result).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content[0]).toMatchObject({ type: 'text' });
            expect(typeof result.content[0].text).toBe('string');
            expect(result.content[0].text).toMatch(/cyclic/);
            expect(result.isError).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('validatePlan unknown dependency check', () => {
    test('rejects plan with nonexistent dependency', async () => {
        const { validatePlan } = await import('../../server/validate-plan.js');
        const result = validatePlan({
            nodes: [
                { id: 'n1', depends_on: ['n2'], task: 'x', review_criteria: [] },
                { id: 'n2', depends_on: ['n3'], task: 'x', review_criteria: [] },
            ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('n2') && e.includes('n3'))).toBe(true);
    });

    test('accepts plan with valid dependencies', async () => {
        const { validatePlan } = await import('../../server/validate-plan.js');
        const result = validatePlan({
            nodes: [
                { id: 'n1', depends_on: [], task: 'x', review_criteria: [] },
                { id: 'n2', depends_on: ['n1'], task: 'x', review_criteria: [] },
                { id: 'n3', depends_on: ['n1', 'n2'], task: 'x', review_criteria: [] },
            ],
        });
        expect(result.valid).toBe(true);
    });

    test('rejects self-reference as cycle', async () => {
        const { validatePlan } = await import('../../server/validate-plan.js');
        const result = validatePlan({
            nodes: [{ id: 'n1', depends_on: ['n1'], task: 'x', review_criteria: [] }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('cyclic'))).toBe(true);
    });
});

describe('pi.on(input) handler compliance', () => {
    test('intercepts /squad command', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const inputHandler = pi.events.find((e) => e.event === 'input');
        expect(inputHandler).toBeDefined();

        const ctx = {
            ui: { notify: () => {} },
            sessionManager: { getSessionId: () => 'sid' },
        };

        const result = await inputHandler.handler(
            { text: '/squad write hello', images: [], source: 'interactive', type: 'input' },
            ctx,
        );
        // Must return handled:true to block further processing
        expect(result).toEqual({ handled: true });
    });

    test('registers /squad command', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const cmd = pi.commands.find((c) => c.name === 'squad');
        expect(cmd).toBeDefined();
        expect(cmd.description).toMatch(/squad/i);
        expect(typeof cmd.handler).toBe('function');
    });

    test('registers session_shutdown handler', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const shutdownHandler = pi.events.find((e) => e.event === 'session_shutdown');
        expect(shutdownHandler).toBeDefined();
        expect(typeof shutdownHandler.handler).toBe('function');
    });

    test('registers agent_end handler', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const agentEndHandler = pi.events.find((e) => e.event === 'agent_end');
        expect(agentEndHandler).toBeDefined();
        expect(typeof agentEndHandler.handler).toBe('function');
    });

    test('squad_delegate tool has defaultInactive: true', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const tool = pi.tools.find((t) => t.name === 'squad_delegate');
        expect(tool).toBeDefined();
        expect(tool.defaultInactive).toBe(true);
    });

    test('execute returns inactive error when squad not activated', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const tool = pi.tools.find((t) => t.name === 'squad_delegate');
        const ctx = {
            sessionManager: { getSessionId: () => 'test' },
        };

        const result = await tool.execute('call-0', { plan_dir: '/tmp' }, undefined, undefined, ctx);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not active/);
    });

    test('squad command activates squad and sends message', async () => {
        _resetSquadState();
        const pi = mockPi();
        let sentMessage = null;
        pi.sendMessage = (msg, opts) => {
            sentMessage = { msg, opts };
        };
        squadPlugin(pi);

        const ctx = { ui: { notify: () => {} } };
        const cmd = pi.commands.find((c) => c.name === 'squad');
        await cmd.handler('write hello world', ctx);

        expect(sentMessage).not.toBeNull();
        expect(sentMessage.msg.customType).toBe('squad-activate');
        expect(sentMessage.msg.display).toBe(true);
        expect(sentMessage.opts.triggerTurn).toBe(true);
        expect(sentMessage.msg.content).toContain('write hello world');
    });

    test('empty squad command shows usage notification', async () => {
        _resetSquadState();
        const pi = mockPi();
        let notified = null;
        const ctx = {
            ui: {
                notify: (msg, type) => {
                    notified = { msg, type };
                },
            },
        };
        squadPlugin(pi);

        const cmd = pi.commands.find((c) => c.name === 'squad');
        await cmd.handler('', ctx);

        expect(notified).not.toBeNull();
        expect(notified.msg).toContain('Usage');
    });

    test('session_shutdown clears squad active state', async () => {
        _resetSquadState();
        const pi = mockPi();
        let widgetCleared = false;
        squadPlugin(pi);

        const ctx = {
            ui: {
                setWidget: (key, val) => {
                    if (key === 'squad_status' && val === undefined) widgetCleared = true;
                },
            },
        };

        // Activate first
        const activateCtx = { ui: { notify: () => {} } };
        const cmd = pi.commands.find((c) => c.name === 'squad');
        await cmd.handler('test task', activateCtx);

        // Then shutdown
        const shutdownHandler = pi.events.find((e) => e.event === 'session_shutdown');
        await shutdownHandler.handler({ type: 'session_shutdown' }, ctx);

        expect(widgetCleared).toBe(true);

        // After shutdown, tool should return inactive
        const tool = pi.tools.find((t) => t.name === 'squad_delegate');
        const result = await tool.execute('call-0', { plan_dir: '/tmp' }, undefined, undefined, ctx);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not active/);
    });

    test('execute returns inactive error on second test run w/o activation', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const tool = pi.tools.find((t) => t.name === 'squad_delegate');
        const ctx = {
            sessionManager: { getSessionId: () => 'test' },
        };

        // Should give inactive error without activation
        const result = await tool.execute('call-0', { plan_dir: '/tmp' }, undefined, undefined, ctx);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not active/);
    });

    test('non-/squad input returns void (not handled)', async () => {
        _resetSquadState();
        const pi = mockPi();
        squadPlugin(pi);

        const inputHandler = pi.events.find((e) => e.event === 'input');

        const result = await inputHandler.handler(
            { text: 'just a normal message', images: [], source: 'interactive', type: 'input' },
            { ui: { notify: () => {} } },
        );
        // void return → input flows through normally
        expect(result).toBeUndefined();
    });
});

describe('buildWorkerSessionOptions filter regression', () => {
    test('filters squad_delegate from worker session tools', () => {
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['squad_delegate', 'read', 'write'],
        };
        const opts = _getWorkerSessionOptions(pi);
        expect(opts.toolNames).not.toContain('squad_delegate');
        expect(opts.toolNames).toContain('read');
    });

    test('adds return tool when not in active tools', () => {
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['read', 'write'],
        };
        const opts = _getWorkerSessionOptions(pi);
        expect(opts.toolNames).toContain('return');
    });

    test('does not duplicate return when already present', () => {
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['read', 'write', 'return'],
        };
        const opts = _getWorkerSessionOptions(pi);
        const count = opts.toolNames.filter((t) => t === 'return').length;
        expect(count).toBe(1);
    });

    test('carries forward thinkingLevel from parent session', () => {
        const pi = {
            getThinkingLevel: () => 'high',
            getActiveTools: () => ['read'],
        };
        const opts = _getWorkerSessionOptions(pi);
        expect(opts.thinkingLevel).toBe('high');
    });
});

describe('session:prompting handler await regression', () => {
    beforeEach(() => {
        _clearTestSession();
    });

    afterEach(() => {
        _clearTestSession();
    });

    test('awaits session.prompt() before resolving', async () => {
        let promptCalled = false;
        let promptResolve;
        const promptPromise = new Promise((resolve) => {
            promptResolve = resolve;
        });

        const mockEntry = {
            session: {
                prompt: async (text) => {
                    promptCalled = true;
                    await promptPromise;
                },
            },
            status: 'active',
        };

        _setTestSession('s1', mockEntry);

        const handler = EffectHandlers['session:prompting'];
        expect(handler).toBeDefined();

        const handlerPromise = handler(
            {
                sessionId: 's1',
                phase: 'authoring',
                nodeId: 'n1',
                promptText: 'test prompt text',
            },
            { broadcast: null },
        );

        // Give microtasks a chance to run
        await new Promise((r) => setTimeout(r, 0));
        expect(promptCalled).toBe(true);

        // Handler should NOT be resolved yet (it's awaiting the prompt)
        const race = await Promise.race([
            handlerPromise.then(() => 'resolved'),
            new Promise((r) => setTimeout(() => r('still pending'), 5)),
        ]);
        expect(race).toBe('still pending');

        // Resolve the prompt promise
        promptResolve();

        // Now handler should resolve
        const result = await handlerPromise;
        expect(result).toBeUndefined();
    });

    test('returns void when session not in store', async () => {
        const handler = EffectHandlers['session:prompting'];
        const result = await handler(
            { sessionId: 'nonexistent', phase: 'authoring', nodeId: 'n1', promptText: 'hi' },
            { broadcast: null },
        );
        expect(result).toBeUndefined();
    });

    test('returns void when session status is not active', async () => {
        _setTestSession('s2', { session: {}, status: 'completed' });

        const handler = EffectHandlers['session:prompting'];
        const result = await handler(
            { sessionId: 's2', phase: 'authoring', nodeId: 'n1', promptText: 'hi' },
            { broadcast: null },
        );
        expect(result).toBeUndefined();
    });
});

describe('squad:phase_changed handler contract regression', () => {
    test('returns session:message fact when phase=revising and mainSession exists', async () => {
        const state = getInitialState();
        state.squad.mainSessionId = 'main-123';
        state.sessions['main-123'] = { sessionId: 'main-123', messageIds: [] };

        const pi = {
            sendMessage: () => {},
        };

        const handler = EffectHandlers['squad:phase_changed'];
        expect(handler).toBeDefined();

        const result = await handler(
            {
                phase: 'revising',
                feedback: 'The solution is incomplete',
            },
            {
                getState: () => state,
                pi,
            },
        );

        // Must return a session:message fact (not append directly to eventLog)
        expect(result).toBeDefined();
        expect(result.type).toBe('session:message');
        expect(result.payload.sessionId).toBe('main-123');
        expect(result.payload.role).toBe('user');
        expect(result.payload.content[0].text).toContain('The solution is incomplete');
    });

    test('returns void when phase is not revising', async () => {
        const handler = EffectHandlers['squad:phase_changed'];
        const result = await handler({ phase: 'active', feedback: '' }, { getState: () => getInitialState(), pi: {} });
        expect(result).toBeUndefined();
    });

    test('returns void when mainSessionId is not set', async () => {
        const state = getInitialState(); // mainSessionId is null

        const handler = EffectHandlers['squad:phase_changed'];
        const result = await handler({ phase: 'revising', feedback: 'test' }, { getState: () => state, pi: {} });
        expect(result).toBeUndefined();
    });

    test('calls pi.sendMessage with triggerTurn when phase=revising', async () => {
        const state = getInitialState();
        state.squad.mainSessionId = 'main-456';
        state.sessions['main-456'] = { sessionId: 'main-456', messageIds: [] };

        let sentMsg = null;
        let sentOpts = null;
        const pi = {
            sendMessage: (msg, opts) => {
                sentMsg = msg;
                sentOpts = opts;
            },
        };

        const handler = EffectHandlers['squad:phase_changed'];
        await handler({ phase: 'revising', feedback: 'needs rework' }, { getState: () => state, pi });

        expect(sentMsg).not.toBeNull();
        expect(sentMsg.customType).toBe('squad-awakening');
        expect(sentMsg.display).toBe(false);
        expect(sentOpts.triggerTurn).toBe(true);
        expect(sentMsg.content).toContain('needs rework');
        expect(sentMsg.content).toContain('squad_delegate');
    });
});

describe('agent_end safety net regression', () => {
    afterEach(() => {
        _resetSquadState();
        _restoreGlobalEventLog();
    });

    /** Track only squad-revision-force messages, ignore activation sendMessage */
    function makeForceTracker() {
        const sent = [];
        return {
            tracker: (msg, opts) => {
                if (msg.customType === 'squad-revision-force') {
                    sent.push(msg);
                }
            },
            sent,
        };
    }

    function makeRevisingEventLog() {
        const el = new EventLog();
        el.append('squad:init', {
            mode: 'L',
            nodes: [{ id: 'n1', task: 'test', review_criteria: ['ok'], depends_on: [] }],
            mainSessionId: 'main-999',
        });
        // Manually advance to revising phase
        el.append('squad:phase_changed', { phase: 'revising', feedback: 'rejected' });
        return el;
    }

    function activateSquadForHandler(pi) {
        const cmd = pi.commands.find((c) => c.name === 'squad');
        return cmd.handler('test task', { ui: { notify: () => {} } });
    }

    test('sends force message when phase is revising and EventLog available', async () => {
        _resetSquadState();
        const { tracker, sent } = makeForceTracker();
        const pi = mockPi();
        pi.sendMessage = tracker;
        squadPlugin(pi);

        _setTestEventLog(makeRevisingEventLog());
        await activateSquadForHandler(pi);

        const agentEndHandler = pi.events.find((e) => e.event === 'agent_end');
        await agentEndHandler.handler({ type: 'agent_end' }, {});

        expect(sent.length).toBe(1);
        expect(sent[0].customType).toBe('squad-revision-force');
        expect(sent[0].content).toContain('squad_delegate');
    });

    test('does NOT send force message when squad not active', async () => {
        _resetSquadState();
        const { tracker, sent } = makeForceTracker();
        const pi = mockPi();
        pi.sendMessage = tracker;
        squadPlugin(pi);

        // Don't activate squad
        const agentEndHandler = pi.events.find((e) => e.event === 'agent_end');
        await agentEndHandler.handler({ type: 'agent_end' }, {});

        expect(sent.length).toBe(0);
    });

    test('does NOT send force message when EventLog is null', async () => {
        _resetSquadState();
        const { tracker, sent } = makeForceTracker();
        const pi = mockPi();
        pi.sendMessage = tracker;
        squadPlugin(pi);

        await activateSquadForHandler(pi);
        // Don't set test EventLog — getGlobalEventLog returns null

        const agentEndHandler = pi.events.find((e) => e.event === 'agent_end');
        await agentEndHandler.handler({ type: 'agent_end' }, {});

        expect(sent.length).toBe(0);
    });

    test('does NOT send force message when phase is not revising', async () => {
        _resetSquadState();
        const { tracker, sent } = makeForceTracker();
        const pi = mockPi();
        pi.sendMessage = tracker;
        squadPlugin(pi);

        const el = new EventLog();
        el.append('squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', task: 'test', review_criteria: ['ok'], depends_on: [] }],
            mainSessionId: 'main-777',
        });
        _setTestEventLog(el);
        await activateSquadForHandler(pi);

        const agentEndHandler = pi.events.find((e) => e.event === 'agent_end');
        await agentEndHandler.handler({ type: 'agent_end' }, {});

        expect(sent.length).toBe(0);
    });
});

describe('pi.sendMessage call signature compliance', () => {
    test('sendMessage params match ExtensionAPI SendMessageHandler', async () => {
        _resetSquadState();
        const pi = mockPi();
        const sent = [];
        pi.sendMessage = (msg, opts) => {
            sent.push({ msg, opts });
        };
        squadPlugin(pi);

        const ctx = { ui: { notify: () => {} } };
        const cmd = pi.commands.find((c) => c.name === 'squad');
        await cmd.handler('write code', ctx);

        expect(sent.length).toBe(1);
        expect(sent[0].msg).toMatchObject({
            customType: expect.any(String),
            content: expect.any(String),
            display: true,
        });
        // triggerTurn: true — correct per ExtensionAPI SendMessageHandler
        expect(sent[0].opts).toMatchObject({ triggerTurn: true });

        // Verify NOT awaited (return is void, not a promise)
        const ret = pi.sendMessage({ customType: 'test', content: '', display: false });
        expect(ret).toBeUndefined();
    });
});
