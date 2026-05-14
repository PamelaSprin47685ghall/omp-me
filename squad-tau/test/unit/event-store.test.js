import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyEvent, getInitialState } from '../../shared/projections.js';
import { EventStore } from '../../client/event-store.js';

function freshState() {
    return getInitialState();
}

function dispatch(state, type, payload) {
    return applyEvent(state, type, payload);
}

// Delta handling is implemented in EventStore.applyDelta, not in projections.
// These tests validate the delta accumulation behavior.

function createStore() {
    const store = new EventStore();
    // Seed a session via dispatch
    store.dispatch('session:start', { sessionId: 's1', phase: 'worker' });
    return store;
}

test('SESSION_MESSAGE_DELTA appends text to existing message', () => {
    const store = createStore();
    store.dispatch('session:message', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        messageId: 'm1',
    });
    store.dispatch('session:message_delta', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: ' world' },
    });
    const state = store.getState();
    const msg = state.sessions.s1.messages[0];
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.messageId, 'm1');
    assert.equal(msg.streaming, true);
});

test('SESSION_MESSAGE_DELTA creates placeholder for orphaned delta', () => {
    const store = createStore();
    store.dispatch('session:message_delta', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: 'orphaned' },
    });
    const state = store.getState();
    const list = state.sessions.s1.messages;
    assert.equal(list.length, 1);
    assert.equal(list[0].role, 'assistant');
    assert.equal(list[0].messageId, 'm1');
    assert.equal(list[0].streaming, true);
});

test('SESSION_MESSAGE_DELTA appends consecutive deltas', () => {
    const store = createStore();
    store.dispatch('session:message_delta', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: 'first ' },
    });
    store.dispatch('session:message_delta', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'text_delta', text: 'second' },
    });
    const state = store.getState();
    assert.equal(state.sessions.s1.messages[0].streaming, true);
});

test('SESSION_MESSAGE_DELTA adds thinking_delta as separate block', () => {
    const store = createStore();
    store.dispatch('session:message', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        messageId: 'm1',
    });
    store.dispatch('session:message_delta', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'thinking_delta', text: 'reasoning' },
    });
    const state = store.getState();
    const msg = state.sessions.s1.messages[0];
    assert.equal(msg.content.length, 2);
    assert.equal(msg.content[0].type, 'text');
    assert.equal(msg.content[1].type, 'thinking');
});

test('SESSION_MESSAGE_DELTA appends to existing thinking block', () => {
    const store = createStore();
    store.dispatch('session:message_delta', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'thinking_delta', text: 'think' },
    });
    store.dispatch('session:message_delta', {
        sessionId: 's1',
        messageId: 'm1',
        delta: { type: 'thinking_delta', text: ' more' },
    });
    const state = store.getState();
    const block = state.sessions.s1.messages[0].content[0];
    assert.equal(block.type, 'thinking');
    assert.equal(state.sessions.s1.messages[0].streaming, true);
});

test('SESSION_TOOL_CALL adds tool call entry', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    dispatch(state, 'session:tool_call', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
    });
    const msg = state.sessions.s1.messages[0];
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.messageId, 't1');
    assert.deepEqual(msg.content, [{ type: 'tool_call', toolName: 'read', toolId: 't1', params: { path: 'file.js' } }]);
});

test('SESSION_TOOL_RESULT updates tool call result', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    dispatch(state, 'session:tool_call', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
    });
    dispatch(state, 'session:tool_result', {
        sessionId: 's1',
        toolId: 't1',
        result: 'file content',
        isError: false,
    });
    const block = state.sessions.s1.messages[0].content[0];
    assert.equal(block.result, 'file content');
    assert.equal(block.isError, false);
});

test('SESSION_TOOL_RESULT with error', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    dispatch(state, 'session:tool_call', {
        sessionId: 's1',
        toolName: 'bash',
        toolId: 't1',
        params: { command: 'rm -rf /' },
    });
    dispatch(state, 'session:tool_result', {
        sessionId: 's1',
        toolId: 't1',
        result: 'permission denied',
        isError: true,
    });
    const block = state.sessions.s1.messages[0].content[0];
    assert.equal(block.isError, true);
});

test('SESSION_TOOL_RESULT ignores missing session or tool call', () => {
    const state = dispatch(freshState(), 'session:tool_result', {
        sessionId: 'nonexistent',
        toolId: 't1',
        result: 'x',
        isError: false,
    });
    assert.equal(state.sessions.nonexistent, undefined);
});
