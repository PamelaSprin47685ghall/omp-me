/**
 * Tests for oh-studio — the oh-my-pi adaptor for pi-studio.
 *
 * Follows the same pattern as oh-taskplane/test/plugin.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------------------------------------------------------
// createBridge
// --------------------------------------------------------------------------

describe('createBridge', () => {
    it('forwards registerTool', async () => {
        const { createBridge } = await import('../index.js');

        const tools = [];
        const pi = {
            registerTool: (t) => tools.push(t),
            on: () => {},
        };

        const bridge = createBridge(pi);
        bridge.registerTool({ name: 'test-tool' });

        assert.equal(tools.length, 1);
        assert.equal(tools[0].name, 'test-tool');
    });

    it('forwards registerCommand', async () => {
        const { createBridge } = await import('../index.js');

        const cmds = [];
        const pi = {
            registerCommand: (n, o) => cmds.push(n),
            on: () => {},
        };

        const bridge = createBridge(pi);
        bridge.registerCommand('test-cmd', {});

        assert.equal(cmds.length, 1);
        assert.equal(cmds[0], 'test-cmd');
    });

    it('forwards on() for supported events', async () => {
        const { createBridge } = await import('../index.js');

        const events = [];
        const pi = {
            on: (event) => events.push(event),
        };

        const bridge = createBridge(pi);
        bridge.on('session_start', () => {});
        bridge.on('agent_start', () => {});
        bridge.on('message_end', () => {});
        bridge.on('session_shutdown', () => {});

        assert.equal(events.length, 4);
        assert.ok(events.includes('session_start'));
        assert.ok(events.includes('session_shutdown'));
    });

    it('silently drops unsupported events (model_select)', async () => {
        const { createBridge } = await import('../index.js');

        const events = [];
        const pi = {
            on: (event) => events.push(event),
        };

        const bridge = createBridge(pi);
        bridge.on('model_select', () => {});

        assert.equal(events.length, 0);
    });

    it('forwards sendMessage', async () => {
        const { createBridge } = await import('../index.js');

        const sent = [];
        const pi = {
            on: () => {},
            sendMessage: (m) => sent.push(['msg', m.customType]),
        };

        const bridge = createBridge(pi);
        bridge.sendMessage({ customType: 'test-type' });

        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0], ['msg', 'test-type']);
    });

    it('forwards sendUserMessage', async () => {
        const { createBridge } = await import('../index.js');

        const sent = [];
        const pi = {
            on: () => {},
            sendUserMessage: (c) => sent.push(typeof c === 'string' ? c.slice(0, 20) : ''),
        };

        const bridge = createBridge(pi);
        bridge.sendUserMessage('hello world');

        assert.equal(sent.length, 1);
    });

    it('forwards sendUserMessage with options', async () => {
        const { createBridge } = await import('../index.js');

        const opts = [];
        const pi = {
            on: () => {},
            sendUserMessage: (c, o) => opts.push(o),
        };

        const bridge = createBridge(pi);
        bridge.sendUserMessage('hello', { deliverAs: 'steer' });

        assert.equal(opts.length, 1);
        assert.deepEqual(opts[0], { deliverAs: 'steer' });
    });

    it('forwards appendEntry', async () => {
        const { createBridge } = await import('../index.js');

        const entries = [];
        const pi = {
            on: () => {},
            appendEntry: (t, d) => entries.push([t, d]),
        };

        const bridge = createBridge(pi);
        bridge.appendEntry('test-type', { key: 'value' });

        assert.equal(entries.length, 1);
        assert.deepEqual(entries[0], ['test-type', { key: 'value' }]);
    });

    it('forwards setModel', async () => {
        const { createBridge } = await import('../index.js');

        let called = false;
        const pi = {
            on: () => {},
            setModel: (m) => {
                called = true;
                return Promise.resolve(true);
            },
        };

        const bridge = createBridge(pi);
        const result = await bridge.setModel({ provider: 'anthropic', id: 'claude' });

        assert.ok(called);
        assert.ok(result);
    });

    it('forwards getSessionName', async () => {
        const { createBridge } = await import('../index.js');

        const pi = {
            on: () => {},
            getSessionName: () => 'test-session',
        };

        const bridge = createBridge(pi);
        const name = bridge.getSessionName();

        assert.equal(name, 'test-session');
    });

    it('forwards getThinkingLevel', async () => {
        const { createBridge } = await import('../index.js');

        const pi = {
            on: () => {},
            getThinkingLevel: () => undefined,
        };

        const bridge = createBridge(pi);
        const level = bridge.getThinkingLevel();

        assert.equal(level, undefined);
    });

    it('forwards setLabel', async () => {
        const { createBridge } = await import('../index.js');

        const labels = [];
        const pi = {
            on: () => {},
            setLabel: (l) => labels.push(l),
        };

        const bridge = createBridge(pi);
        bridge.setLabel('my-label');

        assert.equal(labels.length, 1);
        assert.equal(labels[0], 'my-label');
    });
});

// --------------------------------------------------------------------------
// Shim packages
// --------------------------------------------------------------------------

describe('shim packages', () => {
    it('@mariozechner/pi-coding-agent exports getAgentDir', async () => {
        const mod = await import('@mariozechner/pi-coding-agent');
        assert.equal(typeof mod.getAgentDir, 'function');
    });

    it('@mariozechner/pi-coding-agent exports DynamicBorder', async () => {
        const mod = await import('@mariozechner/pi-coding-agent');
        assert.equal(typeof mod.DynamicBorder, 'function');
    });
});
