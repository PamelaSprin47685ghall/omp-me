import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sessionReducer, INITIAL_STATE } from '../session-reducer.js';

function dispatch(state, type, payload) {
    return sessionReducer(state, { type, payload });
}

function withSession(state) {
    return dispatch(state, 'SESSION_START', { sessionId: 's1', phase: 'worker' });
}

test('SESSION_MESSAGE_DELTA appends text to existing message', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'SESSION_MESSAGE_DELTA', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: ' world' },
    });
    assert.deepEqual(state.messages.get('s1')[0].content, [{ type: 'text', text: 'Hello world' }]);
});

test('SESSION_MESSAGE_DELTA creates placeholder for orphaned delta', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_MESSAGE_DELTA', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: 'orphaned' },
    });
    const list = state.messages.get('s1');
    assert.equal(list.length, 1);
    assert.equal(list[0].role, 'assistant');
    assert.equal(list[0].messageId, 'm1');
    assert.deepEqual(list[0].content, [{ type: 'text', text: 'orphaned' }]);
});

test('SESSION_MESSAGE_DELTA appends consecutive deltas', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_MESSAGE_DELTA', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: 'first ' },
    });
    state = dispatch(state, 'SESSION_MESSAGE_DELTA', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: 'second' },
    });
    assert.deepEqual(state.messages.get('s1')[0].content, [{ type: 'text', text: 'first second' }]);
});

test('SESSION_MESSAGE_DELTA adds thinking_delta as separate block', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'SESSION_MESSAGE_DELTA', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'thinking_delta', text: 'reasoning' },
    });
    assert.deepEqual(state.messages.get('s1')[0].content, [
        { type: 'text', text: 'answer' },
        { type: 'thinking', text: 'reasoning' },
    ]);
});

test('SESSION_MESSAGE_DELTA appends to existing thinking block', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_MESSAGE_DELTA', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'thinking_delta', text: 'think' },
    });
    state = dispatch(state, 'SESSION_MESSAGE_DELTA', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'thinking_delta', text: ' more' },
    });
    assert.deepEqual(state.messages.get('s1')[0].content, [{ type: 'thinking', text: 'think more' }]);
});

test('SESSION_TOOL_CALL adds tool call entry', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_TOOL_CALL', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
    });
    const msg = state.messages.get('s1')[0];
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.messageId, 't1');
    assert.deepEqual(msg.content, [{ type: 'tool_call', toolName: 'read', toolId: 't1', params: { path: 'file.js' } }]);
});

test('SESSION_TOOL_RESULT updates tool call result', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_TOOL_CALL', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
    });
    state = dispatch(state, 'SESSION_TOOL_RESULT', {
        sessionId: 's1',
        toolId: 't1',
        result: 'file content',
        isError: false,
    });
    const block = state.messages.get('s1')[0].content[0];
    assert.equal(block.result, 'file content');
    assert.equal(block.isError, false);
});

test('SESSION_TOOL_RESULT with error', () => {
    let state = withSession(INITIAL_STATE);
    state = dispatch(state, 'SESSION_TOOL_CALL', {
        sessionId: 's1',
        toolName: 'bash',
        toolId: 't1',
        params: { command: 'rm -rf /' },
    });
    state = dispatch(state, 'SESSION_TOOL_RESULT', {
        sessionId: 's1',
        toolId: 't1',
        result: 'permission denied',
        isError: true,
    });
    const block = state.messages.get('s1')[0].content[0];
    assert.equal(block.isError, true);
});

test('SESSION_TOOL_RESULT ignores missing session or tool call', () => {
    const state = dispatch(INITIAL_STATE, 'SESSION_TOOL_RESULT', {
        sessionId: 'nonexistent',
        toolId: 't1',
        result: 'x',
        isError: false,
    });
    assert.equal(state.messages.get('nonexistent'), undefined);
});
