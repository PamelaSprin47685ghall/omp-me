import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import minimaxSearchExtension from '../index.js';

describe('extension registration', () => {
    it('registers three tools', async () => {
        const tools = [];
        const pi = mockPi({ registerTool: (t) => tools.push(t) });
        await minimaxSearchExtension(pi);
        const names = tools.map((t) => t.name);
        assert.ok(names.includes('minimax_search'));
        assert.ok(names.includes('minimax_vision'));
        assert.ok(names.includes('minimax_fetch'));
        assert.equal(tools.length, 3);
    });

    it('registers /minimax-key command', async () => {
        const commands = {};
        const pi = mockPi({ registerCommand: (n, c) => (commands[n] = c) });
        await minimaxSearchExtension(pi);
        assert.ok(commands['minimax-key']);
        assert.equal(typeof commands['minimax-key'].handler, 'function');
    });

    it('prevents duplicate registration via WeakSet', async () => {
        let calls = 0;
        const pi = mockPi({ registerTool: () => calls++ });
        await minimaxSearchExtension(pi);
        await minimaxSearchExtension(pi);
        assert.equal(calls, 3);
    });

    it('allows retry after transient failure', async () => {
        let failOnce = true;
        const pi = mockPi({
            registerTool: () => {
                if (failOnce) {
                    failOnce = false;
                    throw new Error('fail');
                }
            },
        });
        await assert.rejects(() => minimaxSearchExtension(pi), /fail/);
        await assert.doesNotReject(() => minimaxSearchExtension(pi));
    });
});

describe('key management', () => {
    it('throws when API key is not set', async () => {
        const { pi, restore } = setupKeyTest();
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const search = tools.find((t) => t.name === 'minimax_search');
            await assert.rejects(
                () => search.execute('c1', { query: 'test' }, new AbortController().signal),
                /MINIMAX_API_KEY/,
            );
        } finally {
            restore();
        }
    });

    it('/minimax-key stores key in memory and file', async () => {
        const { pi, tempHome, restore } = setupKeyTest();
        try {
            const notifications = [];
            const commands = {};
            pi.registerCommand = (n, c) => (commands[n] = c);
            pi.ui = { notify: (m) => notifications.push(m) };
            await minimaxSearchExtension(pi);
            await commands['minimax-key'].handler('test-key-123', { ui: pi.ui });
            assert.ok(notifications.some((n) => n.includes('saved')));
            const filePath = join(tempHome, '.omp', 'agent', 'minimax.json');
            const data = JSON.parse(readFileSync(filePath, 'utf-8'));
            assert.equal(data.MINIMAX_API_KEY, 'test-key-123');
        } finally {
            restore();
        }
    });

    it('key priority: memory > file > env', async () => {
        const originalEnv = process.env.MINIMAX_API_KEY;
        const originalHome = process.env.OMP_MINIMAX_HOME;
        const tempHome = mkdtempSync(join(tmpdir(), 'minimax-test-'));
        process.env.OMP_MINIMAX_HOME = tempHome;
        process.env.MINIMAX_API_KEY = 'env-key';
        mkdirSync(join(tempHome, '.omp', 'agent'), { recursive: true });
        writeFileSync(join(tempHome, '.omp', 'agent', 'minimax.json'), JSON.stringify({ MINIMAX_API_KEY: 'file-key' }));

        try {
            const tools = [];
            const commands = {};
            const pi = mockPi({ registerTool: (t) => tools.push(t), registerCommand: (n, c) => (commands[n] = c) });
            await minimaxSearchExtension(pi);
            await commands['minimax-key'].handler('memory-key', { ui: { notify: () => {} } });

            let usedKey = '';
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (_url, opts) => {
                usedKey = opts.headers.Authorization.replace('Bearer ', '');
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({ organic: [], base_resp: { status_code: 0 } }),
                };
            };

            const search = tools.find((t) => t.name === 'minimax_search');
            await search.execute('c1', { query: 'test' }, new AbortController().signal);
            globalThis.fetch = originalFetch;
            assert.equal(usedKey, 'memory-key');
        } finally {
            if (originalEnv) process.env.MINIMAX_API_KEY = originalEnv;
            else delete process.env.MINIMAX_API_KEY;
            if (originalHome) process.env.OMP_MINIMAX_HOME = originalHome;
            else delete process.env.OMP_MINIMAX_HOME;
            rmSync(tempHome, { recursive: true, force: true });
        }
    });
});

describe('minimax_search', () => {
    it('validates empty query', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const search = tools.find((t) => t.name === 'minimax_search');
            await assert.rejects(
                () => search.execute('c1', { query: '' }, new AbortController().signal),
                /query is required/,
            );
            await assert.rejects(
                () => search.execute('c1', { query: '   ' }, new AbortController().signal),
                /query is required/,
            );
        } finally {
            restore();
        }
    });

    it('formats results as markdown', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                status: 200,
                text: async () =>
                    JSON.stringify({
                        organic: [{ title: 'T1', link: 'https://a.com', snippet: 'S1' }],
                        related_searches: [{ query: 'Q1' }],
                        base_resp: { status_code: 0 },
                    }),
            });
            const search = tools.find((t) => t.name === 'minimax_search');
            const res = await search.execute('c1', { query: 'test' }, new AbortController().signal);
            globalThis.fetch = originalFetch;
            assert.ok(res.content[0].text.includes('T1'));
            assert.ok(res.details.organic);
        } finally {
            restore();
        }
    });

    it('returns "No results found." for empty organic', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ organic: [], base_resp: { status_code: 0 } }),
            });
            const search = tools.find((t) => t.name === 'minimax_search');
            const res = await search.execute('c1', { query: 'test' }, new AbortController().signal);
            globalThis.fetch = originalFetch;
            assert.equal(res.content[0].text, 'No results found.');
        } finally {
            restore();
        }
    });
});

describe('minimax_vision', () => {
    it('validates empty prompt and image_url', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const vision = tools.find((t) => t.name === 'minimax_vision');
            await assert.rejects(() => vision.execute('c1', { prompt: '', image_url: 'x' }), /prompt is required/);
            await assert.rejects(() => vision.execute('c1', { prompt: 'x', image_url: '' }), /image_url is required/);
        } finally {
            restore();
        }
    });

    it('rejects unsupported local image format', async () => {
        const { pi, tempHome, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const vision = tools.find((t) => t.name === 'minimax_vision');
            const bmpPath = join(tempHome, 'img.bmp');
            writeFileSync(bmpPath, 'fake');
            await assert.rejects(
                () => vision.execute('c1', { prompt: 'x', image_url: bmpPath }),
                /Unsupported image format/,
            );
        } finally {
            restore();
        }
    });

    it('rejects nonexistent local file', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const vision = tools.find((t) => t.name === 'minimax_vision');
            await assert.rejects(
                () => vision.execute('c1', { prompt: 'x', image_url: '/nonexistent/file.png' }),
                /Local image file does not exist/,
            );
        } finally {
            restore();
        }
    });

    it('passes through data URI unchanged', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const originalFetch = globalThis.fetch;
            let body;
            globalThis.fetch = async (_url, opts) => {
                body = JSON.parse(opts.body);
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({ content: 'analysis', base_resp: { status_code: 0 } }),
                };
            };
            const vision = tools.find((t) => t.name === 'minimax_vision');
            const res = await vision.execute('c1', { prompt: 'x', image_url: 'data:image/png;base64,abc' });
            globalThis.fetch = originalFetch;
            assert.equal(body.image_url, 'data:image/png;base64,abc');
            assert.equal(res.content[0].text, 'analysis');
        } finally {
            restore();
        }
    });
});

describe('minimax_fetch', () => {
    it('validates invalid URL format', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const fetch = tools.find((t) => t.name === 'minimax_fetch');
            await assert.rejects(
                () => fetch.execute('c1', { url: 'ftp://bad' }, new AbortController().signal),
                /url must start with http/,
            );
        } finally {
            restore();
        }
    });

    it('rejects when createAgentSession is unavailable', async () => {
        const { pi, restore } = setupWithKey('k');
        try {
            const tools = [];
            pi.registerTool = (t) => tools.push(t);
            await minimaxSearchExtension(pi);
            const fetch = tools.find((t) => t.name === 'minimax_fetch');
            await assert.rejects(
                () => fetch.execute('c1', { url: 'https://example.com' }, new AbortController().signal),
                /createAgentSession unavailable/,
            );
        } finally {
            restore();
        }
    });
});

function mockPi(overrides) {
    return {
        on: () => {},
        registerTool: () => {},
        registerCommand: () => {},
        registerProvider: () => {},
        typebox: {
            Object: (props) => ({ type: 'object', properties: props }),
            String: (opts) => ({ type: 'string', ...opts }),
            Number: (opts) => ({ type: 'number', ...opts }),
            Optional: (schema) => schema,
        },
        ...overrides,
    };
}

function setupKeyTest() {
    const originalKey = process.env.MINIMAX_API_KEY;
    const originalHome = process.env.OMP_MINIMAX_HOME;
    const tempHome = mkdtempSync(join(tmpdir(), 'minimax-test-'));
    process.env.OMP_MINIMAX_HOME = tempHome;
    delete process.env.MINIMAX_API_KEY;
    const pi = mockPi({});
    return {
        pi,
        tempHome,
        restore: () => {
            if (originalKey) process.env.MINIMAX_API_KEY = originalKey;
            else delete process.env.MINIMAX_API_KEY;
            if (originalHome) process.env.OMP_MINIMAX_HOME = originalHome;
            else delete process.env.OMP_MINIMAX_HOME;
            rmSync(tempHome, { recursive: true, force: true });
        },
    };
}

function setupWithKey(key) {
    const originalKey = process.env.MINIMAX_API_KEY;
    const originalHome = process.env.OMP_MINIMAX_HOME;
    const tempHome = mkdtempSync(join(tmpdir(), 'minimax-test-'));
    process.env.OMP_MINIMAX_HOME = tempHome;
    process.env.MINIMAX_API_KEY = key;
    const pi = mockPi({});
    return {
        pi,
        tempHome,
        restore: () => {
            if (originalKey) process.env.MINIMAX_API_KEY = originalKey;
            else delete process.env.MINIMAX_API_KEY;
            if (originalHome) process.env.OMP_MINIMAX_HOME = originalHome;
            else delete process.env.OMP_MINIMAX_HOME;
            rmSync(tempHome, { recursive: true, force: true });
        },
    };
}
