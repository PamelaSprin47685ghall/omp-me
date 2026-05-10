import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sessionReducer, INITIAL_STATE } from './useSessionState.js';

function dispatch(state, type, payload) {
    return sessionReducer(state, { type, payload });
}

test('returns initial state', () => {
    assert.equal(INITIAL_STATE.sessions.size, 0);
    assert.equal(INITIAL_STATE.messages.size, 0);
});

test('SESSION_START adds session and initializes message list', () => {
    const state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        nodeId: 'n1',
        phase: 'worker',
        retryCount: 0,
        model: { provider: 'openai', id: 'gpt-4' },
    });
    const session = state.sessions.get('s1');
    assert.equal(session.nodeId, 'n1');
    assert.equal(session.phase, 'worker');
    assert.equal(session.status, 'active');
    assert.deepEqual(state.messages.get('s1'), []);
});

test('SESSION_START preserves existing messages on re-dispatch', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    assert.equal(state.messages.get('s1').length, 1);
});

test('SESSION_STATE updates session phase', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_STATE', {
        sessionId: 's1',
        phase: 'authoring',
    });
    assert.equal(state.sessions.get('s1').phase, 'authoring');
});

test('SESSION_STATE ignores unknown session', () => {
    const state = dispatch(INITIAL_STATE, 'SESSION_STATE', {
        sessionId: 'nonexistent',
        phase: 'authoring',
    });
    assert.equal(state.sessions.get('nonexistent'), undefined);
});

test('SESSION_MESSAGE appends full message', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    const msg = state.messages.get('s1')[0];
    assert.equal(msg.role, 'user');
    assert.equal(msg.messageId, 'm1');
    assert.deepEqual(msg.content, [{ type: 'text', text: 'hello' }]);
});

test('SESSION_MESSAGE with parentId', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        messageId: 'm2',
        parentId: 'm1',
    });
    assert.equal(state.messages.get('s1')[0].parentId, 'm1');
});

test('SESSION_MESSAGE_DELTA appends text to existing message', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
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
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
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

test('SESSION_MESSAGE_DELTA orphaned delta followed by deltas appends correctly', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
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
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
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
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
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
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_TOOL_CALL', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
    });
    const msg = state.messages.get('s1')[0];
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.messageId, 't1');
    assert.deepEqual(msg.content, [
        {
            type: 'tool_call',
            toolName: 'read',
            toolId: 't1',
            params: { path: 'file.js' },
        },
    ]);
});

test('SESSION_TOOL_RESULT updates tool call result', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
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
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
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

test('SESSION_TOOL_RESULT ignores missing session', () => {
    const state = dispatch(INITIAL_STATE, 'SESSION_TOOL_RESULT', {
        sessionId: 'nonexistent',
        toolId: 't1',
        result: 'x',
        isError: false,
    });
    assert.equal(state.messages.get('nonexistent'), undefined);
});

test('SESSION_END updates session status', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_END', {
        sessionId: 's1',
        reason: 'completed',
    });
    assert.equal(state.sessions.get('s1').status, 'completed');
});

test('SESSION_END with error includes errorMessage', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_END', {
        sessionId: 's1',
        reason: 'error',
        errorMessage: 'timeout',
    });
    assert.equal(state.sessions.get('s1').status, 'error');
    assert.equal(state.sessions.get('s1').errorMessage, 'timeout');
});

test('SESSION_END ignores unknown session', () => {
    const state = dispatch(INITIAL_STATE, 'SESSION_END', {
        sessionId: 'nonexistent',
        reason: 'completed',
    });
    assert.equal(state.sessions.get('nonexistent'), undefined);
});

test('multiple sessions are isolated', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', {
        sessionId: 's1',
        phase: 'worker',
    });
    state = dispatch(state, 'SESSION_START', {
        sessionId: 's2',
        phase: 'reviewer',
    });
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'msg1' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's2',
        role: 'user',
        content: [{ type: 'text', text: 'msg2' }],
        messageId: 'm2',
    });
    assert.equal(state.messages.get('s1').length, 1);
    assert.equal(state.messages.get('s2').length, 1);
    assert.equal(state.messages.get('s1')[0].content[0].text, 'msg1');
    assert.equal(state.messages.get('s2')[0].content[0].text, 'msg2');
});

test('unknown action type returns state unchanged', () => {
    const state = dispatch(INITIAL_STATE, 'UNKNOWN', {});
    assert.equal(state, INITIAL_STATE);
});
