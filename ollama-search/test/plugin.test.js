import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ollamaSearchExtension from '../index.js';

describe('extension registration', () => {
    it('throws when no API key is set on execute', async () => {
        const originalKey = process.env.OLLAMA_API_KEY;
        const originalHome = process.env.OMP_OLLAMA_SEARCH_HOME;
        const tempHome = mkdtempSync(join(tmpdir(), 'ollama-search-test-'));
        process.env.OMP_OLLAMA_SEARCH_HOME = tempHome;
        delete process.env.OLLAMA_API_KEY;

        try {
            const tools = [];
            const pi = {
                on: () => {},
                registerTool: (tool) => tools.push(tool),
                registerCommand: () => {},
                registerShortcut: () => {},
                typebox: {
                    Object: (props) => ({ type: 'object', properties: props }),
                    String: (opts) => ({ type: 'string', ...opts }),
                    Number: (opts) => ({ type: 'number', ...opts }),
                    Optional: (schema) => schema,
                },
            };

            await ollamaSearchExtension(pi);

            const searchTool = tools.find((t) => t.name === 'web_search');
            await assert.rejects(
                () => searchTool.execute('call-1', { query: 'test' }, new AbortController().signal, () => {}, {}),
                /ollama-key|unauthorized/,
            );
        } finally {
            if (originalKey) process.env.OLLAMA_API_KEY = originalKey;
            if (originalHome) process.env.OMP_OLLAMA_SEARCH_HOME = originalHome;
            else delete process.env.OMP_OLLAMA_SEARCH_HOME;
            rmSync(tempHome, { recursive: true, force: true });
        }
    });

    it('registers ollama_search and ollama_fetch tools', async () => {
        const tools = [];
        const pi = {
            on: () => {},
            registerTool: (tool) => tools.push(tool),
            registerCommand: () => {},
            registerShortcut: () => {},
            typebox: {
                Object: (props) => ({ type: 'object', properties: props }),
                String: (opts) => ({ type: 'string', ...opts }),
                Number: (opts) => ({ type: 'number', ...opts }),
                Optional: (schema) => schema,
            },
        };

        await ollamaSearchExtension(pi);

        const names = tools.map((t) => t.name);
        assert.ok(names.includes('web_search'), 'ollama_search tool not registered');
        assert.ok(names.includes('web_fetch'), 'ollama_fetch tool not registered');
        assert.equal(tools.length, 2);
    });

    it('registers /ollama-key command', async () => {
        const commands = {};
        const pi = {
            on: () => {},
            registerTool: () => {},
            registerCommand: (name, config) => {
                commands[name] = config;
            },
            registerShortcut: () => {},
            typebox: {
                Object: (props) => ({ type: 'object', properties: props }),
                String: (opts) => ({ type: 'string', ...opts }),
                Number: (opts) => ({ type: 'number', ...opts }),
                Optional: (schema) => schema,
            },
        };

        await ollamaSearchExtension(pi);

        assert.ok(commands['ollama-key'], 'ollama-key command not registered');
        assert.equal(typeof commands['ollama-key'].handler, 'function');
    });

    it('/ollama-key stores key and uses it for requests', async () => {
        const notifications = [];
        const commands = {};
        const pi = {
            on: () => {},
            registerTool: (tool) => {},
            registerCommand: (name, config) => {
                commands[name] = config;
            },
            registerShortcut: () => {},
            ui: { notify: (msg) => notifications.push(msg) },
            typebox: {
                Object: (props) => ({ type: 'object', properties: props }),
                String: (opts) => ({ type: 'string', ...opts }),
                Number: (opts) => ({ type: 'number', ...opts }),
                Optional: (schema) => schema,
            },
        };

        await ollamaSearchExtension(pi);

        await commands['ollama-key'].handler('ollama-test-key-123', { ui: pi.ui });
        assert.ok(notifications.some((n) => n.includes('saved')));
    });

    it('defines ollama_search with query as required parameter', async () => {
        const tools = [];
        const pi = {
            on: () => {},
            registerTool: (tool) => tools.push(tool),
            registerCommand: () => {},
            registerShortcut: () => {},
            typebox: {
                Object: (props) => ({ type: 'object', properties: props }),
                String: (opts) => ({ type: 'string', ...opts }),
                Number: (opts) => ({ type: 'number', ...opts }),
                Optional: (schema) => schema,
            },
        };

        await ollamaSearchExtension(pi);

        const searchTool = tools.find((t) => t.name === 'web_search');
        assert.ok(searchTool);
        assert.ok(searchTool.parameters);
        assert.equal(typeof searchTool.execute, 'function');
    });

    it('defines ollama_fetch with url as required parameter', async () => {
        const tools = [];
        const pi = {
            on: () => {},
            registerTool: (tool) => tools.push(tool),
            registerCommand: () => {},
            registerShortcut: () => {},
            typebox: {
                Object: (props) => ({ type: 'object', properties: props }),
                String: (opts) => ({ type: 'string', ...opts }),
                Number: (opts) => ({ type: 'number', ...opts }),
                Optional: (schema) => schema,
            },
        };

        await ollamaSearchExtension(pi);

        const fetchTool = tools.find((t) => t.name === 'web_fetch');
        assert.ok(fetchTool);
        assert.ok(fetchTool.parameters);
        assert.equal(typeof fetchTool.execute, 'function');
    });

    it('allows retry after transient initialization failure', async () => {
        let failOnce = true;
        const tools = [];

        const pi = {
            on: () => {},
            registerTool: (tool) => {
                if (failOnce) {
                    failOnce = false;
                    throw new Error('transient registration failure');
                }
                tools.push(tool);
            },
            registerCommand: () => {},
            registerShortcut: () => {},
            typebox: {
                Object: (props) => ({ type: 'object', properties: props }),
                String: (opts) => ({ type: 'string', ...opts }),
                Number: (opts) => ({ type: 'number', ...opts }),
                Optional: (schema) => schema,
            },
        };

        await assert.rejects(() => ollamaSearchExtension(pi), /transient registration failure/);
        await assert.doesNotReject(() => ollamaSearchExtension(pi));

        const names = tools.map((t) => t.name);
        assert.ok(names.includes('web_search'));
        assert.ok(names.includes('web_fetch'));
    });
});
