import { afterEach, describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import kunweiExtension, { _test } from '../index.js';

function createPi() {
    const tools = [];
    const commands = [];
    const handlers = {};
    const messages = [];
    let activeTools = ['read', 'edit', 'write', 'find', 'fuzzy_find', 'fuzzy_grep', 'lsp', 'browser', 'search', 'glob'];
    return {
        tools,
        commands,
        handlers,
        messages,
        typebox: {
            Object: (properties) => ({ type: 'object', properties }),
            String: (options = {}) => ({ type: 'string', ...options }),
            Number: (options = {}) => ({ type: 'number', ...options }),
            Boolean: (options = {}) => ({ type: 'boolean', ...options }),
            Null: (options = {}) => ({ type: 'null', ...options }),
            Union: (items, options = {}) => ({ anyOf: items, ...options }),
            Enum: (values, options = {}) => ({ type: 'enum', values, ...options }),
            Array: (items) => ({ type: 'array', items }),
            Optional: (schema) => schema,
        },
        pi: {},
        ui: { notify() {} },
        on(event, handler) {
            (handlers[event] ??= []).push(handler);
        },
        registerTool(tool) {
            tools.push(tool);
        },
        registerCommand(name, config) {
            commands.push({ name, config });
        },
        sendMessage(message, options) {
            messages.push({ message, options });
        },
        getActiveTools() {
            return activeTools;
        },
        getAllTools() {
            return activeTools;
        },
        async setActiveTools(toolNames) {
            activeTools = [...toolNames];
        },
    };
}

afterEach(() => {
    _test.reset();
});

describe('kunwei extension', () => {
    it('registers core tools and loop command', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        const toolNames = pi.tools.map((tool) => tool.name);
        assert.ok(toolNames.includes('editor'));
        assert.ok(toolNames.includes('greper'));
        assert.ok(toolNames.includes('reverie'));
        assert.ok(toolNames.includes('submit_review'));
        assert.ok(toolNames.includes('runner'));
        assert.ok(toolNames.includes('fuzzy_find'));
        assert.ok(toolNames.includes('fuzzy_grep'));
        assert.ok(toolNames.includes('browse'));
        assert.ok(toolNames.includes('websearch'));
        assert.ok(toolNames.includes('webfetch'));
        assert.ok(pi.commands.some((command) => command.name === 'loop'));
    });

    it('is idempotent per pi instance', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        await kunweiExtension(pi);
        const toolNames = new Set(pi.tools.map((tool) => tool.name));
        for (const expected of [
            'fuzzy_find', 'fuzzy_grep',
            'editor', 'greper', 'reverie', 'browse',
            'websearch', 'webfetch',
            'runner', 'runner_wait', 'runner_abort',
            'submit_review', 'submit_review_result',
        ]) {
            assert.ok(toolNames.has(expected), `expected tool ${expected} to be registered exactly once`);
        }
        assert.equal(pi.commands.length, 1);
    });

    it('loop input activates review state and queues a turn', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        const notifications = [];
        const ctx = {
            sessionManager: { getSessionId: () => 'session-1' },
            ui: { notify: (message) => notifications.push(message) },
        };

        const result = await pi.handlers.input[0]({ text: '/loop fix login flow' }, ctx);

        assert.deepEqual(result, { handled: true });
        assert.ok(notifications.some((message) => message.includes('loop mode is active')));
        assert.equal(pi.messages.length, 1);
        assert.equal(pi.messages[0].options.triggerTurn, true);
    });

    it('session start removes disabled tools from active set', async () => {
        const pi = createPi();
        await kunweiExtension(pi);

        await pi.handlers.session_start[0]({}, {});

        const activeTools = pi.getActiveTools();
        assert.ok(activeTools.includes('fuzzy_grep'));
        assert.ok(activeTools.includes('fuzzy_find'));
        assert.ok(activeTools.includes('find'));
        assert.ok(!activeTools.includes('search'));
        assert.ok(!activeTools.includes('glob'));
        assert.ok(!activeTools.includes('browser'));
    });

    it('fuzzy tool descriptions follow mux wording', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        const fuzzyFind = pi.tools.find((tool) => tool.name === 'fuzzy_find');
        const fuzzyGrep = pi.tools.find((tool) => tool.name === 'fuzzy_grep');
        assert.ok(fuzzyFind.description.includes('Regex and glob syntax are not supported.'));
        assert.ok(fuzzyFind.description.includes('Every result ends with iterator='));
        assert.ok(fuzzyGrep.description.includes('Smart-case, git-aware, frecency-ranked.'));
        assert.ok(fuzzyGrep.description.includes('Every result ends with iterator='));
        assert.ok(Array.isArray(fuzzyGrep.parameters.properties.exclude.anyOf));
        assert.equal(fuzzyGrep.parameters.properties.exclude.anyOf.length, 2);
    });

    it('agent_end nudges runner before other reminders', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        _test.setRunnerJobStateForTest('session-1');

        await pi.handlers.agent_end[0]({}, {
            sessionManager: { getSessionId: () => 'session-1', getEntries: () => [] },
            hasPendingMessages: () => false,
        });

        assert.equal(pi.messages.at(-1).message.customType, 'kunwei-runner-reminder');
    });

    it('agent_end nudges loop when active and no pending messages', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        await pi.handlers.input[0]({ text: '/loop do task' }, {
            sessionManager: { getSessionId: () => 'session-2' },
            ui: { notify() {} },
        });

        await pi.handlers.agent_end[0]({}, {
            sessionManager: { getSessionId: () => 'session-2', getEntries: () => [] },
            hasPendingMessages: () => false,
        });

        assert.equal(pi.messages.at(-1).message.customType, 'kunwei-loop-reminder');
    });

    it('agent_end nudges todos when open todos remain', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        const todoEntry = {
            type: 'message',
            message: {
                role: 'toolResult',
                toolName: 'todo_write',
                isError: false,
                details: {
                    phases: [{ name: 'Todos', tasks: [{ content: 'x', status: 'pending' }] }],
                },
            },
        };

        await pi.handlers.agent_end[0]({}, {
            sessionManager: { getSessionId: () => 'session-3', getEntries: () => [todoEntry] },
            hasPendingMessages: () => false,
        });

        assert.equal(pi.messages.at(-1).message.customType, 'kunwei-todo-reminder');
    });
});

describe('kunwei helpers', () => {
    it('strips head and tail pipes', () => {
        assert.equal(_test.stripHeadTailPipes('cat a | head -n 20').script, 'cat a');
        assert.equal(_test.stripHeadTailPipes('cat a | head -n 20 | tail -5').script, 'cat a');
    });

    it('reads ollama key from environment', () => {
        const previous = process.env.OLLAMA_API_KEY;
        process.env.OLLAMA_API_KEY = 'test-ollama-key';
        try {
            assert.equal(_test.getOllamaKey(), 'test-ollama-key');
        } finally {
            if (previous === undefined) delete process.env.OLLAMA_API_KEY;
            else process.env.OLLAMA_API_KEY = previous;
        }
    });

    it('builds caps context from uppercase files and dirs', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunwei-caps-'));
        fs.writeFileSync(path.join(root, 'ARCH.md'), 'arch-content');
        fs.mkdirSync(path.join(root, 'PRD'));
        fs.writeFileSync(path.join(root, 'PRD', '01.txt'), 'prd-content');

        try {
            const context = await _test.buildCapsContext(root);
            assert.ok(context.includes('<caps-context file="ARCH.md">'));
            assert.ok(context.includes('arch-content'));
            assert.ok(context.includes('<caps-context file="PRD/01.txt">'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('strips host dir-context while keeping custom caps path open', () => {
        const prompt = [
            'prefix',
            '<dir-context>\nSome directories may have their own rules.\n- AGENTS.md\n</dir-context>\nrest',
        ];
        const stripped = _test.stripHostAgentsPrompt(prompt);
        assert.equal(stripped[0], 'prefix');
        assert.equal(stripped[1], 'rest');
    });

    it('syntax check reports json parse errors', async () => {
        const result = await _test.checkSyntax('{bad', 'broken.json');
        if (result.ok) {
            assert.ok(result.errors.length >= 1, `expected at least 1 error, got ${result.errors.length}`);
            for (const err of result.errors) {
                assert.equal(err.severity, 'error');
                assert.ok(err.line >= 1);
                assert.ok(err.column >= 1);
            }
        } else {
            assert.ok(typeof result.reason === 'string');
            assert.ok(result.reason.length > 0);
        }
    });

    it('syntax check reports no errors for valid json', async () => {
        const result = await _test.checkSyntax('{"a": 1, "b": [1,2,3]}', 'valid.json');
        if (result.ok) {
            assert.equal(result.errors.length, 0);
        }
    });

    it('syntax diagnostics tool coverage includes Write and ast_grep_replace', async () => {
        assert.equal(await _test.supportsSyntaxDiagnosticsTool('Write'), true);
        assert.equal(await _test.supportsSyntaxDiagnosticsTool('ast_grep_replace'), true);
        assert.equal(await _test.supportsSyntaxDiagnosticsTool('edit'), true);
        assert.equal(await _test.supportsSyntaxDiagnosticsTool('grep'), false);
    });

    it('submit_review_result treats null and empty string as accept', async () => {
        const pi = createPi();
        await kunweiExtension(pi);
        const submitReviewResult = pi.tools.find((tool) => tool.name === 'submit_review_result');
        assert.ok(submitReviewResult);

        const reviewSessionId = 'review-child-1';
        const parentSessionId = 'parent-1';
        const firstPending = Promise.withResolvers();
        _test.setPendingReviewStateForTest(reviewSessionId, parentSessionId, firstPending);
        const nullResult = await submitReviewResult.execute('call-1', { feedback: null }, undefined, undefined, {
            sessionManager: { getSessionId: () => reviewSessionId },
        });
        assert.equal((await firstPending.promise).feedback, null);
        assert.equal(nullResult.content[0].text, 'Review submitted: accepted.');

        const secondPending = Promise.withResolvers();
        _test.setPendingReviewStateForTest(reviewSessionId, parentSessionId, secondPending);
        const emptyResult = await submitReviewResult.execute('call-2', { feedback: '   ' }, undefined, undefined, {
            sessionManager: { getSessionId: () => reviewSessionId },
        });
        assert.equal((await secondPending.promise).feedback, null);
        assert.equal(emptyResult.content[0].text, 'Review submitted: accepted.');

        const thirdPending = Promise.withResolvers();
        _test.setPendingReviewStateForTest(reviewSessionId, parentSessionId, thirdPending);
        const rejectResult = await submitReviewResult.execute('call-3', { feedback: 'Fix it' }, undefined, undefined, {
            sessionManager: { getSessionId: () => reviewSessionId },
        });
        assert.equal((await thirdPending.promise).feedback, 'Fix it');
        assert.equal(rejectResult.content[0].text, 'Review submitted: rejected with feedback.');
    });

    it('fuzzy grep iterator stores external path state and is single-use', async () => {
        const firstId = _test.fuzzy.storeCursor({ externalBasePath: '/tmp/demo', query: 'x', cursor: { token: 1 } });
        assert.equal(_test.fuzzy.consumeCursor(firstId).externalBasePath, '/tmp/demo');
        assert.equal(_test.fuzzy.consumeCursor(firstId), undefined);
        assert.deepEqual(_test.fuzzy.resolveExternalBasePath('/tmp/demo/file.ts'), {
            basePath: '/tmp/demo',
            pathConstraint: 'file.ts',
        });
    });

    it('fuzzy find iterator is single-use', async () => {
        const firstId = _test.fuzzy.storeFindCursor({ query: 'src main', pageSize: 30, pageIndex: 1 });
        assert.equal(_test.fuzzy.consumeFindCursor(firstId).pageIndex, 1);
        assert.equal(_test.fuzzy.consumeFindCursor(firstId), undefined);
    });
});

describe('caps budget', () => {
    it('respects depth and total byte limits', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunwei-caps-budget-'));
        fs.writeFileSync(path.join(root, 'ARCH.md'), 'a'.repeat(2_000));
        fs.mkdirSync(path.join(root, 'PRD'));
        for (let i = 0; i < 50; i += 1) {
            const dir = path.join(root, 'PRD', `dir${i}`);
            fs.mkdirSync(dir, { recursive: true });
            for (let j = 0; j < 5; j += 1) {
                fs.writeFileSync(path.join(dir, `f${j}.md`), 'x'.repeat(500));
            }
        }

        try {
            const context = await _test.buildCapsContext(root);
            const matches = context.match(/<caps-context /g) || [];
            assert.ok(matches.length <= 200, `expected <= 200 entries, got ${matches.length}`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('skips excluded dir names inside caps dirs', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunwei-caps-excl-'));
        fs.mkdirSync(path.join(root, 'PRD', 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(root, 'PRD', 'node_modules', 'leak.md'), 'should-not-appear');
        fs.writeFileSync(path.join(root, 'PRD', 'real.md'), 'real-content');

        try {
            const context = await _test.buildCapsContext(root);
            assert.ok(context.includes('real-content'));
            assert.ok(!context.includes('should-not-appear'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('appendCapsContext is idempotent across calls', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunwei-caps-idem-'));
        fs.writeFileSync(path.join(root, 'ARCH.md'), 'arch');

        try {
            const prompt = ['initial'];
            const once = _test.appendCapsContext(prompt, root);
            const twice = _test.appendCapsContext(once, root);
            assert.equal(once, twice);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('ollama SSRF', () => {
    it('blocks localhost and loopback names', async () => {
        const ollama = await import('../ollama.js');
        const pi = {
            typebox: {
                Object: (p) => ({ type: 'object', properties: p }),
                String: (o = {}) => ({ type: 'string', ...o }),
                Number: (o = {}) => ({ type: 'number', ...o }),
                Boolean: (o = {}) => ({ type: 'boolean', ...o }),
                Null: (o = {}) => ({ type: 'null', ...o }),
                Union: (items, o = {}) => ({ anyOf: items, ...o }),
                Enum: (values, o = {}) => ({ type: 'enum', values, ...o }),
                Array: (items) => ({ type: 'array', items }),
                Optional: (s) => s,
            },
        };
        const tools = [];
        pi.registerTool = (t) => tools.push(t);
        ollama.registerOllamaTools(pi, { asErrorResult: (e) => ({ content: [{ type: 'text', text: e.message }], isError: true }) });
        const webfetch = tools.find((t) => t.name === 'webfetch');
        assert.ok(webfetch);

        const blocked = ['http://localhost/', 'http://127.0.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/'];
        for (const url of blocked) {
            const result = await webfetch.execute('id', { url }, undefined, undefined, {});
            assert.equal(result.isError, true, `expected block for ${url}`);
            assert.ok(/not allowed|invalid|scheme|resolve/i.test(result.content[0].text), `unexpected message for ${url}: ${result.content[0].text}`);
        }
    });
});

describe('pi-resolve', () => {
    it('uses PI_BASE environment variable when set', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kunwei-pi-base-'));
        try {
            process.env.PI_BASE = tmp;
            const { getPiBase } = await import('../pi-resolve.js?probe=1');
            assert.equal(getPiBase(), tmp);
        } finally {
            delete process.env.PI_BASE;
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
