import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('createBridge', () => {
    it('maps session_end to session_shutdown', async () => {
        const { createBridge } = await import('../index.js');

        const events = [];
        const pi = {
            registerTool: () => {},
            registerCommand: () => {},
            on: (event) => events.push(event),
            sendMessage: () => {},
            sendUserMessage: () => {},
            setModel: () => Promise.resolve(true),
            setLabel: () => {},
        };

        const bridge = createBridge(pi);
        bridge.on('session_end', () => {});
        bridge.on('session_start', () => {});

        assert.ok(events.includes('session_shutdown'), 'session_end not mapped to session_shutdown');
        assert.ok(!events.includes('session_end'), 'session_end leaked through bridge');
        assert.ok(events.includes('session_start'), 'session_start not passed through');
    });

    it('passes through registerTool calls', async () => {
        const { createBridge } = await import('../index.js');

        const tools = [];
        const pi = {
            registerTool: (t) => tools.push(t),
            on: () => {},
        };

        const bridge = createBridge(pi);
        bridge.registerTool({ name: 'test_tool' });

        assert.equal(tools.length, 1);
        assert.equal(tools[0].name, 'test_tool');
    });

    it('passes through registerCommand calls', async () => {
        const { createBridge } = await import('../index.js');

        const cmds = [];
        const pi = {
            registerCommand: (n, o) => cmds.push(n),
            on: () => {},
        };

        const bridge = createBridge(pi);
        bridge.registerCommand('test_cmd', {});

        assert.equal(cmds.length, 1);
        assert.equal(cmds[0], 'test_cmd');
    });

    it('forwards sendMessage and sendUserMessage', async () => {
        const { createBridge } = await import('../index.js');

        const sent = [];
        const pi = {
            on: () => {},
            sendMessage: (m) => sent.push(['msg', m.customType]),
            sendUserMessage: (c) => sent.push(['user', typeof c === 'string' ? c.slice(0, 20) : '']),
        };

        const bridge = createBridge(pi);
        bridge.sendMessage({ customType: 'test' });
        bridge.sendUserMessage('hello world');

        assert.equal(sent.length, 2);
        assert.deepEqual(sent[0], ['msg', 'test']);
    });

    it('forwards setModel call', async () => {
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
        await bridge.setModel({});

        assert.ok(called);
    });
});

describe('shim packages', () => {
    it('@mariozechner/pi-ai exports Type', async () => {
        const mod = await import('@mariozechner/pi-ai');
        assert.equal(typeof mod.Type, 'object');
        assert.equal(typeof mod.Type.Object, 'function');
    });

    it('@mariozechner/pi-tui exports all components', async () => {
        const mod = await import('@mariozechner/pi-tui');
        assert.equal(typeof mod.Container, 'function');
        assert.equal(typeof mod.SelectList, 'function');
        assert.equal(typeof mod.SettingsList, 'function');
        assert.equal(typeof mod.Text, 'function');
        assert.equal(typeof mod.truncateToWidth, 'function');

        // truncateToWidth is straightforward pure function
        assert.equal(mod.truncateToWidth('hello world', 5), 'hell…');
        assert.equal(mod.truncateToWidth('hello', 10), 'hello');
        assert.equal(mod.truncateToWidth('', 10), '');
    });

    it('@mariozechner/pi-coding-agent exports expected symbols', async () => {
        const mod = await import('@mariozechner/pi-coding-agent');
        assert.equal(typeof mod.DynamicBorder, 'function');
        assert.equal(typeof mod.getSettingsListTheme, 'function');
    });
});
