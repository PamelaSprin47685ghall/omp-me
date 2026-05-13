/**
 * Tests for semantic-edit plugin.
 */

import { describe, it } from 'bun:test';
import assert from 'node:assert';

function createMockPi() {
    const sessions = [];
    const tools = [];
    const commands = [];
    const handlers = {};
    return {
        _sessions: sessions,
        _tools: tools,
        _commands: commands,
        _handlers: handlers,
        registerTool(tool) {
            tools.push(tool);
        },
        registerCommand(name, opts) {
            commands.push({ name, opts });
        },
        sendUserMessage(content, opts) {
            this._sendUserMessageCalls = this._sendUserMessageCalls || [];
            this._sendUserMessageCalls.push({ content, opts });
        },
        sendMessage(msg) {
            this._sendMessageCalls = this._sendMessageCalls || [];
            this._sendMessageCalls.push(msg);
        },
        on(event, handler) {
            (handlers[event] = handlers[event] || []).push(handler);
            return () => {
                handlers[event] = handlers[event].filter((h) => h !== handler);
            };
        },
        emit(event, ...args) {
            (handlers[event] || []).forEach((h) => h(...args));
        },
        pi: {
            async createAgentSession(opts) {
                const messages = [];
                const subscribers = [];
                const session = {
                    sessionFile: `test-session-${sessions.length}.jsonl`,
                    async prompt(text) {
                        messages.push(text);
                    },
                    async waitForIdle() {},
                    subscribe(cb) {
                        subscribers.push(cb);
                        return () => {
                            const idx = subscribers.indexOf(cb);
                            if (idx >= 0) subscribers.splice(idx, 1);
                        };
                    },
                    abort() {},
                };
                sessions.push({ session, opts, messages, subscribers });
                return { session, dispose: () => {} };
            },
        },
    };
}

function settleReturnTool(opts) {
    const returnTool = opts.customTools.find((t) => t.name === 'return_edit');
    if (returnTool) {
        returnTool.execute(null, { status: 'ok', summary: 'done', affected_files: ['src/test.js'] }, null, null, {
            abort: () => {},
        });
    }
}

describe('semantic-edit plugin', () => {
    describe('plugin registration', () => {
        it('registers the semantic_edit tool', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=1');
            const pi = createMockPi();
            await semanticEdit(pi);

            const tool = pi._tools.find((t) => t.name === 'semantic_edit');
            assert.ok(tool, 'Should have semantic_edit tool');
            assert.strictEqual(tool.label, 'Semantic Edit');
        });

        it('does not double-register on repeat calls', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=2');
            const pi = createMockPi();
            await semanticEdit(pi);
            await semanticEdit(pi);

            assert.strictEqual(pi._tools.filter((t) => t.name === 'semantic_edit').length, 1);
        });

        it('registers tool_execution_end handler', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=2b');
            const pi = createMockPi();
            await semanticEdit(pi);

            assert.ok(pi._handlers['session_start']?.length, 'Should register session_start handler');
            assert.ok(pi._handlers['tool_execution_end']?.length, 'Should register tool_execution_end handler');
        });
    });

    describe('tool parameters', () => {
        it('requires intent parameter', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=3');
            const pi = createMockPi();
            await semanticEdit(pi);

            const tool = pi._tools[0];
            assert.strictEqual(tool.parameters.properties.intent.type, 'string');
            assert.deepStrictEqual(tool.parameters.required, ['intent']);
        });

        it('throws when intent is missing', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=4');
            const pi = createMockPi();
            await semanticEdit(pi);

            const tool = pi._tools[0];
            await assert.rejects(
                async () => tool.execute('edit-1', {}, null, null, {}),
                (err) => err.message === 'intent is required',
            );
        });

        it('throws when intent is empty string', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=5');
            const pi = createMockPi();
            await semanticEdit(pi);

            const tool = pi._tools[0];
            await assert.rejects(
                async () => tool.execute('edit-1', { intent: '   ' }, null, null, {}),
                (err) => err.message === 'intent is required',
            );
        });
    });

    describe('subagent session lifecycle', () => {
        it('creates session and sends prompt', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=6');
            const pi = createMockPi();
            await semanticEdit(pi);

            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return origCreate(opts);
            };

            const tool = pi._tools[0];
            const result = await tool.execute('edit-1', { intent: 'add logging to all functions' }, null, null, {});

            assert.strictEqual(result.details.status, 'ok');
            assert.strictEqual(result.details.summary, 'done');
        });

        it('includes recommendation for normal users', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7');
            const pi = createMockPi();
            await semanticEdit(pi);

            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return origCreate(opts);
            };

            const tool = pi._tools[0];
            const result = await tool.execute('edit-1', { intent: 'fix typo' }, null, null, {});

            assert.ok(result.content[0].text.includes('semantic_edit'));
        });

        it('suppresses recommendation for dedicated editors', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=8');
            const pi = createMockPi();
            await semanticEdit(pi);

            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return origCreate(opts);
            };

            const tool = pi._tools[0];
            const ctx = { _semanticEditNoRecommend: true };
            const result = await tool.execute('edit-1', { intent: 'fix typo' }, null, null, ctx);

            assert.ok(!result.content[0].text.includes('semantic_edit'));
        });

        it('passes intent through to subagent prompt', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=9');
            const pi = createMockPi();
            await semanticEdit(pi);

            let capturedPrompt = '';
            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                const result = await origCreate(opts);
                const origPrompt = result.session.prompt;
                result.session.prompt = async (text) => {
                    capturedPrompt = text;
                    return origPrompt(text);
                };
                return result;
            };

            const tool = pi._tools[0];
            await tool.execute('edit-1', { intent: 'refactor the auth module' }, null, null, {});

            assert.ok(capturedPrompt.includes('refactor the auth module'), 'Intent must appear in subagent prompt');
        });

        it('propagates error status from return_edit', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=10');
            const pi = createMockPi();
            await semanticEdit(pi);

            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                const returnTool = opts.customTools.find((t) => t.name === 'return_edit');
                if (returnTool) {
                    returnTool.execute(null, { status: 'error', reason: 'file locked' }, null, null, {
                        abort: () => {},
                    });
                }
                return origCreate(opts);
            };

            const tool = pi._tools[0];
            const result = await tool.execute('edit-1', { intent: 'delete critical file' }, null, null, {});

            assert.strictEqual(result.details.status, 'error');
            assert.strictEqual(result.details.reason, 'file locked');
        });
    });

    describe('edit failure auto-repair', () => {
        it('auto-repairs failed ast-edit edit', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=11');
            const pi = createMockPi();

            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return origCreate(opts);
            };

            await semanticEdit(pi);

            const sessionFile = 'test-repair-ast.jsonl';
            pi.emit('session_start', {}, { sessionManager: { getSessionFile: () => sessionFile } });

            const toolEnd = pi._handlers['tool_execution_end'][0];
            await toolEnd(
                {
                    toolName: 'ast_edit',
                    result: { isError: true, content: [{ type: 'text', text: 'No replacements made' }] },
                    input: { ops: [{ pat: 'oldFn($$$ARGS)', out: 'newFn($$$ARGS)' }], paths: ['src/'] },
                },
                { sessionManager: { getSessionFile: () => sessionFile } },
            );

            assert.ok(pi._sendUserMessageCalls?.length > 0, 'Should send user message on successful auto-repair');
            assert.ok(
                pi._sendUserMessageCalls[0].content.includes('automatically recovered'),
                'Should mention recovery',
            );
        });

        it('auto-repairs failed replace-mode edit', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=12');
            const pi = createMockPi();

            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return origCreate(opts);
            };

            await semanticEdit(pi);

            const sessionFile = 'test-repair-replace.jsonl';
            pi.emit('session_start', {}, { sessionManager: { getSessionFile: () => sessionFile } });

            const toolEnd = pi._handlers['tool_execution_end'][0];
            await toolEnd(
                {
                    toolName: 'edit',
                    result: { isError: true, content: [{ type: 'text', text: 'Could not find exact text' }] },
                    input: { path: 'src/main.js', old_text: 'const foo = 1;', new_text: 'const foo = 2;' },
                },
                { sessionManager: { getSessionFile: () => sessionFile } },
            );

            assert.ok(pi._sendUserMessageCalls?.length > 0);
            const msg = pi._sendUserMessageCalls[0].content;
            assert.ok(msg.includes('automatically recovered'), 'Should mention recovery');
            assert.ok(msg.includes('src/test.js'), 'Should include affected files from repair');
        });

        it('does not trigger for successful edits', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=13');
            const pi = createMockPi();
            await semanticEdit(pi);

            const sessionFile = 'test-repair-success.jsonl';
            pi.emit('session_start', {}, { sessionManager: { getSessionFile: () => sessionFile } });

            const toolEnd = pi._handlers['tool_execution_end'][0];
            await toolEnd(
                {
                    toolName: 'edit',
                    result: { isError: false, content: [{ type: 'text', text: 'Success' }] },
                    input: { path: 'src/test.js', old_text: 'foo', new_text: 'bar' },
                },
                { sessionManager: { getSessionFile: () => sessionFile } },
            );

            assert.ok(!pi._sendUserMessageCalls?.length, 'Should not send message for successful edit');
        });

        it('deduplicates repeated failures for same params', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=14');
            const pi = createMockPi();

            const origCreate = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return origCreate(opts);
            };

            await semanticEdit(pi);

            const sessionFile = 'test-repair-dedupe.jsonl';
            pi.emit('session_start', {}, { sessionManager: { getSessionFile: () => sessionFile } });

            const toolEnd = pi._handlers['tool_execution_end'][0];
            const input = { path: 'src/test.js', old_text: 'const x = 1;', new_text: 'const x = 2;' };

            await toolEnd(
                {
                    toolName: 'edit',
                    result: { isError: true, content: [{ type: 'text', text: 'Could not find' }] },
                    input,
                },
                { sessionManager: { getSessionFile: () => sessionFile } },
            );
            await toolEnd(
                {
                    toolName: 'edit',
                    result: { isError: true, content: [{ type: 'text', text: 'Could not find' }] },
                    input,
                },
                { sessionManager: { getSessionFile: () => sessionFile } },
            );

            assert.strictEqual(
                pi._sendUserMessageCalls?.filter((m) => m.content.includes('automatically recovered')).length,
                1,
                'Should only repair once per unique param set',
            );
        });
    });
});
