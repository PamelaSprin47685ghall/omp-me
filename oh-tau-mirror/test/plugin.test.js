/**
 * Tests for oh-tau-mirror — the oh-my-pi adaptor for tau-mirror.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { runInNewContext } from 'node:vm';

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

    it('normalizeSessionFile expands home-prefixed paths', async () => {
        const mod = await import('../proxy.js');
        assert.equal(mod.normalizeSessionFile('~/test.jsonl'), `${homedir()}/test.jsonl`);
    });

    it('isKnownSessionFile matches home-prefixed upstream session paths', async () => {
        const mod = await import('../proxy.js');
        const absoluteSessionFile = `${homedir()}/.omp/agent/sessions/p/home-path-match.jsonl`;

        mod.addSessionFile(absoluteSessionFile);

        assert.equal(mod.isKnownSessionFile('~/.omp/agent/sessions/p/home-path-match.jsonl'), true);
    });

    it('isKnownSessionFile matches equivalent .pi/.omp session identities', async () => {
        const mod = await import('../proxy.js');
        const ompSessionFile = `${homedir()}/.omp/agent/sessions/p/identity-match.jsonl`;

        mod.addSessionFile(ompSessionFile);

        assert.equal(mod.isKnownSessionFile(`${homedir()}/.pi/agent/sessions/p/identity-match.jsonl`), true);
    });

    it('isKnownSessionFile keeps .pi sessions when known path is non-existent .omp', async () => {
        const mod = await import('../proxy.js');
        const ompSessionFile = `${homedir()}/.omp/agent/sessions/p/nonexistent-before-sync.jsonl`;

        mod.addSessionFile(ompSessionFile);

        assert.equal(mod.isKnownSessionFile(`${homedir()}/.pi/agent/sessions/p/nonexistent-before-sync.jsonl`), true);
    });

    it('injected client script reloads sessions on session catalog changes', async () => {
        const mod = await import('../proxy.js');

        let resolveReload;
        let reloadCount = 0;
        const pendingReload = new Promise((resolve) => {
            resolveReload = resolve;
        });

        const context = {
            JSON,
            Map,
            Promise,
            clearInterval() {},
            clearTimeout() {},
            document: {
                head: { appendChild() {} },
                createElement() {
                    return {
                        className: '',
                        textContent: '',
                        querySelector() { return null; },
                        appendChild() {},
                        remove() {},
                    };
                },
                querySelector() { return null; },
            },
            handleRPCEvent() {},
            isMirrorMode: false,
            mirrorActiveSessionFile: null,
            setInterval() { return 1; },
            setTimeout() { return 1; },
            sidebar: {
                projects: [],
                container: {
                    addEventListener() {},
                },
                loadSessions() {
                    reloadCount += 1;
                    return pendingReload;
                },
            },
            updateMirrorLiveIndicator() {},
            wsClient: {
                handleMessage(msg) {},
            },
        };

        runInNewContext(mod.INJECTED, context);

        // Trigger via handleMessage (our injected code wraps it)
        context.wsClient.handleMessage({ type: 'event', event: { type: 'session_catalog_changed', sessionFile: '/tmp/test.jsonl' } });
        context.wsClient.handleMessage({ type: 'event', event: { type: 'session_catalog_changed', sessionFile: '/tmp/test.jsonl' } });
        assert.equal(reloadCount, 1);

        resolveReload();
        await pendingReload;
    });

    it('injected client script schedules another reload when updates arrive mid-reload', async () => {
        const mod = await import('../proxy.js');

        const loadResolvers = [];
        let reloadCount = 0;

        const context = {
            JSON,
            Map,
            Promise,
            clearInterval() {},
            clearTimeout() {},
            document: {
                head: { appendChild() {} },
                createElement() {
                    return {
                        className: '',
                        textContent: '',
                        querySelector() { return null; },
                        appendChild() {},
                        remove() {},
                    };
                },
                querySelector() { return null; },
            },
            handleRPCEvent() {},
            isMirrorMode: false,
            mirrorActiveSessionFile: null,
            setInterval() { return 1; },
            setTimeout() { return 1; },
            sidebar: {
                projects: [],
                container: {
                    addEventListener() {},
                },
                loadSessions() {
                    reloadCount += 1;
                    return new Promise((resolve) => {
                        loadResolvers.push(resolve);
                    });
                },
            },
            updateMirrorLiveIndicator() {},
            wsClient: {
                handleMessage(msg) {},
            },
        };

        runInNewContext(mod.INJECTED, context);

        context.wsClient.handleMessage({ type: 'event', event: { type: 'session_catalog_changed', sessionFile: '/tmp/one.jsonl' } });
        context.wsClient.handleMessage({ type: 'event', event: { type: 'session_catalog_changed', sessionFile: '/tmp/two.jsonl' } });

        assert.equal(reloadCount, 1);

        loadResolvers[0]();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(reloadCount, 2);

        loadResolvers[1]();
        await Promise.resolve();
    });

    it('injected client script normalizes mirror session switch paths', async () => {
        const mod = await import('../proxy.js');

        const ws = {
            onmessage() {},
        };
        const switchedSessionFiles = [];
        const context = {
            JSON,
            Map,
            Promise,
            clearInterval() {},
            clearTimeout() {},
            document: {
                head: { appendChild() {} },
                createElement() {
                    return {
                        className: '',
                        textContent: '',
                        querySelector() { return null; },
                        appendChild() {},
                        remove() {},
                    };
                },
                querySelector() { return null; },
            },
            handleRPCEvent() {},
            isMirrorMode: true,
            mirrorActiveSessionFile: '/home/test/.omp/agent/sessions/p/demo.jsonl',
            setInterval() { return 1; },
            setTimeout() { return 1; },
            sidebar: {
                projects: [],
                container: {
                    addEventListener() {},
                },
                loadSessions() {
                    return Promise.resolve();
                },
            },
            switchSession(sessionFile) {
                switchedSessionFiles.push(sessionFile);
                return Promise.resolve();
            },
            updateMirrorLiveIndicator() {},
            wsClient: {
                ws,
                connect() {},
            },
        };

        runInNewContext(mod.INJECTED, context);
        await context.switchSession('/home/test/.pi/agent/sessions/p/demo.jsonl', { filePath: '/home/test/.pi/agent/sessions/p/demo.jsonl' }, null);

        assert.equal(switchedSessionFiles.length, 1);
        assert.equal(switchedSessionFiles[0], '/home/test/.omp/agent/sessions/p/demo.jsonl');
    });

    it('injected client script treats equivalent .pi/.omp paths as same active session', async () => {
        const mod = await import('../proxy.js');

        const forwardedMessages = [];
        let sidebarClickHandler = null;

        const context = {
            JSON,
            Map,
            Promise,
            clearInterval() {},
            clearTimeout() {},
            document: {
                head: { appendChild() {} },
                createElement() {
                    return {
                        className: '',
                        textContent: '',
                        querySelector() { return null; },
                        appendChild() {},
                        remove() {},
                    };
                },
                querySelector() { return null; },
                querySelectorAll() {
                    return [];
                },
            },
            handleRPCEvent() {},
            isMirrorMode: false,
            mirrorActiveSessionFile: null,
            setInterval() { return 1; },
            setTimeout() { return 1; },
            sidebar: {
                projects: [],
                container: {
                    addEventListener(eventName, handler) {
                        if (eventName === 'click') sidebarClickHandler = handler;
                    },
                },
                loadSessions() {
                    return Promise.resolve();
                },
            },
            updateMirrorLiveIndicator() {},
            wsClient: {
                handleMessage(message) {
                    forwardedMessages.push(message);
                },
            },
        };

        runInNewContext(mod.INJECTED, context);

        sidebarClickHandler({
            target: {
                closest(selector) {
                    if (selector !== '.session-item') return null;
                    return {
                        dataset: {
                            filePath: '/home/test/.pi/agent/sessions/p/current.jsonl',
                        },
                    };
                },
            },
        });

        context.wsClient.handleMessage({
            type: 'event',
            event: {
                type: 'message_update',
                __sessionFile: '/home/test/.omp/agent/sessions/p/current.jsonl',
            },
        });

        assert.equal(forwardedMessages.length, 1);
    });

    it('injected client script marks mirror active session after sidebar reload', async () => {
        const mod = await import('../proxy.js');

        const activeSessionFiles = [];
        const renderedSessionItem = {
            dataset: {
                filePath: '/home/test/.pi/agent/sessions/p/main-thread.jsonl',
            },
        };

        const context = {
            JSON,
            Map,
            Promise,
            clearInterval() {},
            clearTimeout() {},
            document: {
                head: { appendChild() {} },
                createElement() {
                    return {
                        className: '',
                        textContent: '',
                        querySelector() { return null; },
                        appendChild() {},
                        remove() {},
                    };
                },
                querySelector() { return null; },
                querySelectorAll(selector) {
                    if (selector === '.session-item') return [renderedSessionItem];
                    return [];
                },
            },
            handleRPCEvent() {},
            isMirrorMode: true,
            mirrorActiveSessionFile: '/home/test/.omp/agent/sessions/p/main-thread.jsonl',
            setInterval() { return 1; },
            setTimeout() { return 1; },
            sidebar: {
                projects: [],
                container: {
                    addEventListener() {},
                },
                loadSessions() {
                    context.sidebar.projects = [{
                        sessions: [{
                            filePath: '/home/test/.pi/agent/sessions/p/main-thread.jsonl',
                        }],
                    }];
                    return Promise.resolve();
                },
                setActive(filePath) {
                    activeSessionFiles.push(filePath);
                },
            },
            updateMirrorLiveIndicator() {},
            wsClient: {
                handleMessage() {},
            },
        };

        runInNewContext(mod.INJECTED, context);

        context.wsClient.handleMessage({
            type: 'event',
            event: {
                type: 'session_catalog_changed',
                sessionFile: '/home/test/.omp/agent/sessions/p/main-thread.jsonl',
            },
        });

        await Promise.resolve();
        await Promise.resolve();

        assert.equal(activeSessionFiles.length, 1);
        assert.equal(activeSessionFiles[0], '/home/test/.omp/agent/sessions/p/main-thread.jsonl');
        assert.equal(renderedSessionItem.dataset.filePath, '/home/test/.omp/agent/sessions/p/main-thread.jsonl');
    });

    it('injected client script always creates streaming text container for text-first deltas', async () => {
        const mod = await import('../proxy.js');

        let scrollCalls = 0;
        const contentDiv = {
            streamingThinking: null,
            streamingTextNode: null,
            htmlSnapshot: '',
            querySelector(selector) {
                if (selector === '.streaming-thinking') return this.streamingThinking;
                if (selector === '.streaming-text') return this.streamingTextNode;
                return null;
            },
            appendChild(node) {
                if (node.className === 'streaming-text') this.streamingTextNode = node;
            },
            set innerHTML(value) {
                this.htmlSnapshot = value;
                this.streamingTextNode = null;
            },
            get innerHTML() {
                return this.htmlSnapshot;
            },
        };

        const messageElement = {
            querySelector(selector) {
                if (selector === '.message-content') return contentDiv;
                return null;
            },
        };

        const context = {
            JSON,
            Map,
            Promise,
            clearInterval() {},
            clearTimeout() {},
            document: {
                head: { appendChild() {} },
                createElement() {
                    return {
                        className: '',
                        innerHTML: '',
                        textContent: '',
                        querySelector() { return null; },
                        appendChild() {},
                        remove() {},
                    };
                },
                querySelector() { return null; },
            },
            handleRPCEvent() {},
            isMirrorMode: false,
            messageRenderer: {
                updateStreamingMessage() {},
                escapeHtml(text) {
                    return `safe:${text}`;
                },
                scrollToBottom() {
                    scrollCalls += 1;
                },
            },
            mirrorActiveSessionFile: null,
            setInterval() { return 1; },
            setTimeout() { return 1; },
            sidebar: {
                projects: [],
                container: {
                    addEventListener() {},
                },
                loadSessions() {
                    return Promise.resolve();
                },
            },
            updateMirrorLiveIndicator() {},
            wsClient: {
                handleMessage() {},
            },
        };

        runInNewContext(mod.INJECTED, context);

        context.messageRenderer.updateStreamingMessage(messageElement, 'first text delta');

        assert.ok(contentDiv.streamingTextNode);
        assert.equal(contentDiv.streamingTextNode.innerHTML, 'safe:first text delta');
        assert.equal(scrollCalls, 1);

        contentDiv.streamingThinking = { className: 'streaming-thinking' };
        context.messageRenderer.updateStreamingMessage(messageElement, 'second text delta');

        assert.equal(contentDiv.streamingTextNode.innerHTML, 'safe:second text delta');
        assert.equal(scrollCalls, 2);
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
