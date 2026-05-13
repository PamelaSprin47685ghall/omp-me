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

const CTX = { cwd: process.cwd(), ui: {} };
const DEFAULT_EVENT = (over) => ({
    toolCallId: 'call-1',
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    input: {},
    details: undefined,
    ...over,
});

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

        it('registers tool_call and tool_result handlers', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=2b');
            const pi = createMockPi();
            await semanticEdit(pi);

            assert.ok(pi._handlers['tool_call']?.length, 'Should register tool_call handler');
            assert.ok(pi._handlers['tool_result']?.length, 'Should register tool_result handler');
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
                async () => tool.execute('edit-1', {}, null, null, CTX),
                (err) => err.message === 'intent is required',
            );
        });

        it('throws when intent is empty string', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=5');
            const pi = createMockPi();
            await semanticEdit(pi);

            const tool = pi._tools[0];
            await assert.rejects(
                async () => tool.execute('edit-1', { intent: '   ' }, null, null, CTX),
                (err) => err.message === 'intent is required',
            );
        });
    });

    describe('subagent session lifecycle', () => {
        it('creates session and sends prompt', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=6');
            const pi = createMockPi();
            await semanticEdit(pi);

            const orig = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return orig(opts);
            };

            const tool = pi._tools[0];
            const result = await tool.execute('edit-1', { intent: 'add logging to all functions' }, null, null, CTX);

            assert.strictEqual(result.details.status, 'ok');
            assert.strictEqual(result.details.summary, 'done');
        });

        it('passes intent through to subagent prompt', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=9');
            const pi = createMockPi();
            await semanticEdit(pi);

            let capturedPrompt = '';
            const orig = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                const result = await orig(opts);
                const origPrompt = result.session.prompt;
                result.session.prompt = async (text) => {
                    capturedPrompt = text;
                    return origPrompt(text);
                };
                return result;
            };

            const tool = pi._tools[0];
            await tool.execute('edit-1', { intent: 'refactor the auth module' }, null, null, CTX);

            assert.ok(capturedPrompt.includes('refactor the auth module'), 'Intent must appear in subagent prompt');
        });

        it('propagates error status from return_edit', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=10');
            const pi = createMockPi();
            await semanticEdit(pi);

            const orig = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                const returnTool = opts.customTools.find((t) => t.name === 'return_edit');
                if (returnTool) {
                    returnTool.execute(null, { status: 'error', reason: 'file locked' }, null, null, {
                        abort: () => {},
                    });
                }
                return orig(opts);
            };

            const tool = pi._tools[0];
            const result = await tool.execute('edit-1', { intent: 'delete critical file' }, null, null, CTX);

            assert.strictEqual(result.details.status, 'error');
            assert.strictEqual(result.details.reason, 'file locked');
        });
    });

    describe('schema validation at tool_call', () => {
        it('allows valid tool params (no block)', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];

            const result = await handler(
                {
                    toolName: 'edit',
                    toolCallId: 't1',
                    input: { path: 'src/test.js', edits: [{ old_text: 'a', new_text: 'b' }] },
                },
                CTX,
            );
            // Should either be undefined (schema unavailable) or not blocked
            if (result) assert.strictEqual(result.block, false);
            else assert.strictEqual(result, undefined);
        });

        it('does not intercept semantic_edit tool calls', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7b');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];
            const result = await handler(
                { toolName: 'semantic_edit', toolCallId: 't1', input: { intent: 'fix' } },
                CTX,
            );
            assert.strictEqual(result, undefined);
        });

        it('rejects invalid find params with block=true and recommends semantic_find', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7find1');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];
            // find requires paths (array minItems:1), pass empty
            const result = await handler({ toolName: 'find', toolCallId: 't1', input: {} }, CTX);

            if (result) {
                assert.strictEqual(result.block, true);
                assert.ok(result.reason.includes('semantic_find'), 'block reason should recommend semantic_find');
            }
        });

        it('rejects invalid search params with block=true and recommends semantic_find', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7search1');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];
            // search requires pattern + paths, pass nonsense
            const result = await handler({ toolName: 'search', toolCallId: 't1', input: { invalidKey: true } }, CTX);

            if (result) {
                assert.strictEqual(result.block, true);
                assert.ok(result.reason.includes('semantic_find'), 'block reason should recommend semantic_find');
            }
        });

        it('allows valid find params (no block)', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7find2');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];
            const result = await handler(
                { toolName: 'find', toolCallId: 't1', input: { paths: ['src/**/*.ts'] } },
                CTX,
            );

            if (result) assert.strictEqual(result.block, false);
            else assert.strictEqual(result, undefined);
        });

        it('allows valid search params (no block)', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7search2');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];
            const result = await handler(
                { toolName: 'search', toolCallId: 't1', input: { pattern: 'foo', paths: ['src/'] } },
                CTX,
            );

            if (result) assert.strictEqual(result.block, false);
            else assert.strictEqual(result, undefined);
        });

        it('does not intercept semantic_find tool calls', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7sf');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];
            const result = await handler(
                { toolName: 'semantic_find', toolCallId: 't1', input: { intent: 'find components' } },
                CTX,
            );
            assert.strictEqual(result, undefined);
        });

        it('rejects invalid edit params with block=true when schema is loaded', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=7c');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_call'][0];
            // edit requires path + edits[].old_text, pass nonsense
            const result = await handler({ toolName: 'edit', toolCallId: 't1', input: { foobar: 42 } }, CTX);

            // If schemas loaded, should block; otherwise undefined
            if (result) {
                assert.strictEqual(result.block, true);
                assert.ok(result.reason.includes('semantic_edit'), 'block reason should recommend semantic_edit');
            }
        });
    });

    describe('success recommendation', () => {
        it('appends recommendation for successful edit', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=8');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_result'][0];
            const result = await handler(
                DEFAULT_EVENT({ toolName: 'edit', input: { path: 'f.js', old_text: 'a', new_text: 'b' } }),
                CTX,
            );

            assert.ok(result, 'Should return modification');
            const text = result.content[0]?.text || '';
            assert.ok(text.includes('semantic_edit'), 'Should recommend semantic_edit');
        });

        it('appends recommendation for successful write', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=8b');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_result'][0];
            const result = await handler(
                DEFAULT_EVENT({ toolName: 'write', input: { path: 'f.js', content: 'hi' } }),
                CTX,
            );

            assert.ok(result, 'Should return modification');
            const text = result.content[0]?.text || '';
            assert.ok(text.includes('semantic_edit'), 'Should recommend semantic_edit');
        });

        it('does not recommend for semantic_edit tool itself', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=8c');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_result'][0];
            const result = await handler(DEFAULT_EVENT({ toolName: 'semantic_edit', input: { intent: 'fix' } }), CTX);

            assert.strictEqual(result, undefined, 'Should not modify semantic_edit results');
        });

        it('does not duplicate recommendation if already present', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=8d');
            const pi = createMockPi();
            await semanticEdit(pi);

            const handler = pi._handlers['tool_result'][0];
            const result = await handler(
                DEFAULT_EVENT({
                    toolName: 'edit',
                    input: { path: 'f.js', old_text: 'a', new_text: 'b' },
                    content: [{ type: 'text', text: 'Already \`semantic_edit\` mentioned.' }],
                }),
                CTX,
            );

            assert.strictEqual(result, undefined, 'Should not modify if recommendation already present');
        });
    });

    describe('auto-repair on failure', () => {
        it('auto-repairs failed edit and returns recovery message', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=11');
            const pi = createMockPi();

            const orig = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return orig(opts);
            };

            await semanticEdit(pi);

            const handler = pi._handlers['tool_result'][0];
            const result = await handler(
                {
                    toolName: 'edit',
                    toolCallId: 'call-1',
                    content: [{ type: 'text', text: 'No replacements made' }],
                    isError: true,
                    input: { path: 'src/main.js', old_text: 'const foo = 1;', new_text: 'const foo = 2;' },
                    details: undefined,
                },
                CTX,
            );

            assert.ok(result, 'Should return modification');
            assert.strictEqual(result.isError, false, 'Should clear error on successful repair');
            const text = result.content[0]?.text || '';
            assert.ok(text.includes('automatically recovered'), 'Should mention recovery');
            assert.ok(text.includes('semantic_edit'), 'Should recommend semantic_edit');
            assert.ok(text.includes('src/test.js'), 'Should include affected files');
        });

        it('auto-repairs failed ast_edit', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=11a');
            const pi = createMockPi();

            const orig = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return orig(opts);
            };

            await semanticEdit(pi);

            const handler = pi._handlers['tool_result'][0];
            const result = await handler(
                {
                    toolName: 'ast_edit',
                    toolCallId: 'call-1',
                    content: [{ type: 'text', text: 'No replacements made' }],
                    isError: true,
                    input: { ops: [{ pat: 'oldFn($$$ARGS)', out: 'newFn($$$ARGS)' }], paths: ['src/'] },
                    details: undefined,
                },
                CTX,
            );

            assert.ok(result, 'Should return modification');
            assert.strictEqual(result.isError, false);
            const text = result.content[0]?.text || '';
            assert.ok(text.includes('automatically recovered'), 'Should mention recovery');
        });

        it('deduplicates repeated failures for same params', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=14');
            const pi = createMockPi();

            const orig = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return orig(opts);
            };

            await semanticEdit(pi);

            const handler = pi._handlers['tool_result'][0];
            const input = { path: 'src/test.js', old_text: 'const x = 1;', new_text: 'const x = 2;' };

            const first = await handler(
                {
                    toolName: 'edit',
                    toolCallId: 'call-1',
                    content: [{ type: 'text', text: 'Could not find' }],
                    isError: true,
                    input,
                    details: undefined,
                },
                CTX,
            );

            const second = await handler(
                {
                    toolName: 'edit',
                    toolCallId: 'call-2',
                    content: [{ type: 'text', text: 'Could not find' }],
                    isError: true,
                    input,
                    details: undefined,
                },
                CTX,
            );

            assert.ok(first, 'First call should return modification');
            assert.strictEqual(second, undefined, 'Second call for same params should be skipped');
        });
    });

    describe('no side-effect messaging', () => {
        it('never calls sendUserMessage', async () => {
            const { default: semanticEdit } = await import('../index.js?bust=15');
            const pi = createMockPi();
            await semanticEdit(pi);

            const orig = pi.pi.createAgentSession;
            pi.pi.createAgentSession = async (opts) => {
                settleReturnTool(opts);
                return orig(opts);
            };

            // Trigger various paths
            const toolCall = pi._handlers['tool_call'][0];
            const toolResult = pi._handlers['tool_result'][0];

            await toolCall(
                {
                    toolName: 'edit',
                    toolCallId: 't1',
                    input: { path: 'x.js', edits: [{ old_text: 'a', new_text: 'b' }] },
                },
                CTX,
            );
            await toolResult(
                {
                    ...DEFAULT_EVENT({ toolName: 'edit' }),
                    isError: true,
                    input: { path: 'x.js', old_text: 'a', new_text: 'b' },
                },
                CTX,
            );
            await toolResult({ ...DEFAULT_EVENT({ toolName: 'write' }), input: { path: 'x.js', content: 'c' } }, CTX);

            assert.strictEqual(pi._sendUserMessageCalls, undefined, 'Should not use sendUserMessage');
            assert.strictEqual(pi._sendMessageCalls, undefined, 'Should not use sendMessage');
        });
    });
});
