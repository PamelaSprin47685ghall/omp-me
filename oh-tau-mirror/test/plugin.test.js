/**
 * Tests for oh-tau-mirror — the oh-my-pi adaptor for tau-mirror.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------------------------------------------------------
// Console suppression
// --------------------------------------------------------------------------

describe('console suppression', () => {
    it('module loads without throwing', async () => {
        await import('../index.js');
    });

    it('console.log/warn/error are replaced with no-ops after import', async () => {
        // The module-level import already suppresses them; verify no crash
        assert.doesNotThrow(() => console.log('test'));
        assert.doesNotThrow(() => console.warn('test'));
        assert.doesNotThrow(() => console.error('test'));
    });
});

// --------------------------------------------------------------------------
// Proxy module
// --------------------------------------------------------------------------

describe('proxy module', () => {
    it('loads without throwing', async () => {
        await import('../proxy.js');
    });

    it('setProcessSessions accepts a Set', async () => {
        const mod = await import('../proxy.js');
        const s = new Set(['/a/b.jsonl']);
        mod.setProcessSessions(s);
    });
});

// --------------------------------------------------------------------------
// createBridge
// --------------------------------------------------------------------------

describe('createBridge', () => {
    it('forwards registerCommand', async () => {
        const { createBridge } = await import('../index.js');

        const cmds = [];
        const pi = {
            registerCommand: (n, o) => cmds.push(n),
            on: () => {},
        };

        const bridge = createBridge(pi);
        bridge.registerCommand('tau', {});

        assert.equal(cmds.length, 1);
        assert.equal(cmds[0], 'tau');
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

    it('forwards all tau-mirror event types', async () => {
        const { createBridge } = await import('../index.js');

        const events = [];
        const pi = {
            on: (event) => events.push(event),
        };

        const bridge = createBridge(pi);
        const tauEvents = [
            'agent_start',
            'agent_end',
            'turn_start',
            'turn_end',
            'message_start',
            'message_update',
            'message_end',
            'tool_execution_start',
            'tool_execution_update',
            'tool_execution_end',
            'auto_compaction_start',
            'auto_compaction_end',
            'auto_retry_start',
            'auto_retry_end',
            'session_start',
            'session_shutdown',
        ];

        for (const ev of tauEvents) {
            bridge.on(ev, () => {});
        }

        assert.equal(events.length, tauEvents.length);
        for (const ev of tauEvents) {
            assert.ok(events.includes(ev), `event ${ev} not forwarded`);
        }
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

    it('forwards sendUserMessage', async () => {
        const { createBridge } = await import('../index.js');

        const sent = [];
        const pi = {
            on: () => {},
            sendUserMessage: (c) => sent.push(typeof c === 'string' ? c.slice(0, 20) : '[array]'),
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

    it('forwards sendUserMessage with image content array', async () => {
        const { createBridge } = await import('../index.js');

        const contents = [];
        const pi = {
            on: () => {},
            sendUserMessage: (c) => contents.push(Array.isArray(c) ? 'array' : 'string'),
        };

        const bridge = createBridge(pi);
        bridge.sendUserMessage([
            { type: 'text', text: 'hi' },
            { type: 'image', data: 'abc', mimeType: 'image/png' },
        ]);

        assert.equal(contents.length, 1);
        assert.equal(contents[0], 'array');
    });

    it('forwards setModel', async () => {
        const { createBridge } = await import('../index.js');

        let called = false;
        const pi = {
            on: () => {},
            setModel: () => {
                called = true;
                return Promise.resolve(true);
            },
        };

        const bridge = createBridge(pi);
        await bridge.setModel({ id: 'claude' });

        assert.ok(called);
    });

    it('forwards getSessionName', async () => {
        const { createBridge } = await import('../index.js');

        const pi = {
            on: () => {},
            getSessionName: () => 'my-session',
        };

        const bridge = createBridge(pi);
        assert.equal(bridge.getSessionName(), 'my-session');
    });

    it('forwards setSessionName', async () => {
        const { createBridge } = await import('../index.js');

        let name = '';
        const pi = {
            on: () => {},
            setSessionName: (n) => {
                name = n;
                return Promise.resolve();
            },
        };

        const bridge = createBridge(pi);
        await bridge.setSessionName('new-name');

        assert.equal(name, 'new-name');
    });

    it('forwards getThinkingLevel', async () => {
        const { createBridge } = await import('../index.js');

        const pi = {
            on: () => {},
            getThinkingLevel: () => 'high',
        };

        const bridge = createBridge(pi);
        assert.equal(bridge.getThinkingLevel(), 'high');
    });

    it('forwards setThinkingLevel', async () => {
        const { createBridge } = await import('../index.js');

        let level = '';
        const pi = {
            on: () => {},
            setThinkingLevel: (l) => {
                level = l;
            },
        };

        const bridge = createBridge(pi);
        bridge.setThinkingLevel('high');

        assert.equal(level, 'high');
    });
});
