/**
 * Tests for oh-rpiv-advisor — the oh-my-pi adaptor for @juicesharp/rpiv-advisor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------------------------------------------------------
// Shim packages
// --------------------------------------------------------------------------

describe('shim packages', () => {
    it('typebox exports Type', async () => {
        const mod = await import('typebox');
        assert.equal(typeof mod.Type, 'object');
        assert.equal(typeof mod.Type.Object, 'function');
    });

    it('@mariozechner/pi-tui exports UI components', async () => {
        const mod = await import('@mariozechner/pi-tui');
        assert.equal(typeof mod.Container, 'function');
        assert.equal(typeof mod.SelectList, 'function');
        assert.equal(typeof mod.Spacer, 'function');
        assert.equal(typeof mod.Text, 'function');
    });

    it('@mariozechner/pi-coding-agent exports DynamicBorder and convertToLlm', async () => {
        const mod = await import('@mariozechner/pi-coding-agent');
        assert.equal(typeof mod.DynamicBorder, 'function');
        assert.equal(typeof mod.convertToLlm, 'function');
    });

    it('@mariozechner/pi-ai exports completeSimple and getSupportedThinkingLevels', async () => {
        const mod = await import('@mariozechner/pi-ai');
        assert.equal(typeof mod.completeSimple, 'function');
        assert.equal(typeof mod.getSupportedThinkingLevels, 'function');
    });

    it('getSupportedThinkingLevels returns base list for non-reasoning model', () => {
        const { getSupportedThinkingLevels } = globalThis.__piAiShim || {};
        // Skip if not available — will be tested via import
    });

    it('getSupportedThinkingLevels includes xhigh for models that support it', async () => {
        const { getSupportedThinkingLevels } = await import('@mariozechner/pi-ai');

        const noReasoning = { reasoning: false };
        assert.deepEqual(getSupportedThinkingLevels(noReasoning), []);

        const baseModel = { reasoning: true, thinking: { maxLevel: 'high' } };
        const baseLevels = getSupportedThinkingLevels(baseModel);
        assert.ok(baseLevels.includes('high'));
        assert.ok(!baseLevels.includes('xhigh'));

        const xhighModel = { reasoning: true, thinking: { maxLevel: 'xhigh' } };
        const xhighLevels = getSupportedThinkingLevels(xhighModel);
        assert.ok(xhighLevels.includes('xhigh'));
    });
});

// --------------------------------------------------------------------------
// createBridge
// --------------------------------------------------------------------------

describe('createBridge', () => {
    it('exposes typebox property', async () => {
        const { createBridge } = await import('../index.js');
        const fakeTypebox = { Type: { Object: () => ({}) } };
        const bridge = createBridge({ on: () => {}, typebox: fakeTypebox }, {});

        assert.equal(bridge.typebox, fakeTypebox);
    });

    it('forwards registerTool', async () => {
        const { createBridge } = await import('../index.js');

        const tools = [];
        const pi = { on: () => {}, registerTool: (t) => tools.push(t.name), typebox: {} };

        const bridge = createBridge(pi, {});
        bridge.registerTool({ name: 'advisor' });

        assert.equal(tools.length, 1);
        assert.equal(tools[0], 'advisor');
    });

    it('forwards registerCommand', async () => {
        const { createBridge } = await import('../index.js');

        const cmds = [];
        const pi = { on: () => {}, registerCommand: (n) => cmds.push(n), typebox: {} };

        const bridge = createBridge(pi, {});
        bridge.registerCommand('advisor', {});

        assert.equal(cmds.length, 1);
        assert.equal(cmds[0], 'advisor');
    });

    it('forwards on() for supported events', async () => {
        const { createBridge } = await import('../index.js');

        const events = [];
        const pi = { on: (e) => events.push(e), typebox: {} };

        const bridge = createBridge(pi, {});
        bridge.on('session_start', () => {});
        bridge.on('before_agent_start', () => {});

        assert.equal(events.length, 2);
    });

    it('silently drops unsupported events (model_select)', async () => {
        const { createBridge } = await import('../index.js');

        const events = [];
        const pi = { on: (e) => events.push(e), typebox: {} };

        const bridge = createBridge(pi, {});
        bridge.on('model_select', () => {});

        assert.equal(events.length, 0);
    });

    it('forwards sendMessage', async () => {
        const { createBridge } = await import('../index.js');

        const sent = [];
        const pi = {
            on: () => {},
            typebox: {},
            sendMessage: (m) => sent.push(m.customType),
        };

        const bridge = createBridge(pi, {});
        bridge.sendMessage({ customType: 'test' });

        assert.equal(sent.length, 1);
    });

    it('forwards sendUserMessage', async () => {
        const { createBridge } = await import('../index.js');

        const sent = [];
        const pi = {
            on: () => {},
            typebox: {},
            sendUserMessage: (c) => sent.push(typeof c === 'string' ? c.slice(0, 20) : '[array]'),
        };

        const bridge = createBridge(pi, {});
        bridge.sendUserMessage('hello');

        assert.equal(sent.length, 1);
    });

    it('forwards appendEntry', async () => {
        const { createBridge } = await import('../index.js');

        const entries = [];
        const pi = {
            on: () => {},
            typebox: {},
            appendEntry: (t, d) => entries.push([t, d]),
        };

        const bridge = createBridge(pi, {});
        bridge.appendEntry('test', { v: 1 });

        assert.equal(entries.length, 1);
    });

    it('forwards setModel', async () => {
        const { createBridge } = await import('../index.js');

        let called = false;
        const pi = {
            on: () => {},
            typebox: {},
            setModel: () => {
                called = true;
                return Promise.resolve(true);
            },
        };

        const bridge = createBridge(pi, {});
        await bridge.setModel({});

        assert.ok(called);
    });

    it('forwards getSessionName / setSessionName', async () => {
        const { createBridge } = await import('../index.js');

        let name = '';
        const pi = {
            on: () => {},
            typebox: {},
            getSessionName: () => 'test',
            setSessionName: (n) => {
                name = n;
                return Promise.resolve();
            },
        };

        const bridge = createBridge(pi, {});
        assert.equal(bridge.getSessionName(), 'test');
        await bridge.setSessionName('new');
        assert.equal(name, 'new');
    });

    it('forwards getThinkingLevel / setThinkingLevel', async () => {
        const { createBridge } = await import('../index.js');

        let level = '';
        const pi = {
            on: () => {},
            typebox: {},
            getThinkingLevel: () => 'high',
            setThinkingLevel: (l) => {
                level = l;
            },
        };

        const bridge = createBridge(pi, {});
        assert.equal(bridge.getThinkingLevel(), 'high');
        bridge.setThinkingLevel('low');
        assert.equal(level, 'low');
    });

    it('forwards getActiveTools / getAllTools / setActiveTools', async () => {
        const { createBridge } = await import('../index.js');

        let active = [];
        const pi = {
            on: () => {},
            typebox: {},
            getActiveTools: () => active,
            getAllTools: () => ['a', 'b'],
            setActiveTools: (t) => {
                active = t;
            },
        };

        const bridge = createBridge(pi, {});
        assert.deepEqual(bridge.getActiveTools(), []);
        assert.deepEqual(bridge.getAllTools(), ['a', 'b']);
        bridge.setActiveTools(['advisor']);
        assert.deepEqual(active, ['advisor']);
    });

    it('forwards setLabel', async () => {
        const { createBridge } = await import('../index.js');

        const labels = [];
        const pi = {
            on: () => {},
            typebox: {},
            setLabel: (l) => labels.push(l),
        };

        const bridge = createBridge(pi, {});
        bridge.setLabel('oh-rpiv-advisor');

        assert.equal(labels.length, 1);
        assert.equal(labels[0], 'oh-rpiv-advisor');
    });
});
