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

function createStore() {
    const store = new EventStore();
    store.dispatch('session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    return store;
}

// ── Entity Lifecycle ──

test('entity:created creates message entity and appends to session', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'entity:created', {
        entityType: 'message',
        entityId: 'm1',
        sessionId: 's1',
        role: 'assistant',
    });
    const msg = state.messages['m1'];
    assert.ok(msg);
    assert.equal(msg.messageId, 'm1');
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.status, 'created');
    assert.equal(msg.staticContent, undefined);
    assert.deepEqual(msg.toolIds, []);
    assert.equal(state.sessions.s1.messageIds.includes('m1'), true);
});

test('entity:created with staticContent creates user message', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'entity:created', {
        entityType: 'message',
        entityId: 'm1',
        sessionId: 's1',
        role: 'user',
        staticContent: 'Hello world',
    });
    assert.equal(state.messages['m1'].staticContent, 'Hello world');
    assert.equal(state.messages['m1'].role, 'user');
});

test('entity:finalized sets status to finalized', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'entity:created', {
        entityType: 'message',
        entityId: 'm1',
        sessionId: 's1',
        role: 'assistant',
    });
    assert.equal(state.messages['m1'].status, 'created');
    dispatch(state, 'entity:finalized', {
        entityType: 'message',
        entityId: 'm1',
        sessionId: 's1',
    });
    assert.equal(state.messages['m1'].status, 'finalized');
});

test('entity:finalized with staticContent sets it only when provided', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'entity:created', {
        entityType: 'message',
        entityId: 'm1',
        sessionId: 's1',
        role: 'assistant',
    });
    dispatch(state, 'entity:finalized', {
        entityType: 'message',
        entityId: 'm1',
        sessionId: 's1',
        staticContent: 'Final text',
    });
    assert.equal(state.messages['m1'].staticContent, 'Final text');
});

// ── Legacy session:message_start (mapped by WS hook) ──

test('session:message_start creates message entity skeleton', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:message_start', {
        sessionId: 's1',
        messageId: 'm1',
        role: 'assistant',
    });
    const msg = state.messages['m1'];
    assert.equal(msg.messageId, 'm1');
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.status, 'created');
    assert.equal(msg.staticContent, undefined);
    assert.equal(state.sessions.s1.messageIds.includes('m1'), true);
});

// ── session:message (legacy, final fact from server) ──

test('session:message for assistant finalizes existing entity', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:message_start', { sessionId: 's1', messageId: 'm1', role: 'assistant' });
    dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        messageId: 'm1',
    });
    const msg = state.messages['m1'];
    assert.equal(msg.status, 'finalized');
    // Content is NOT stored in state tree — only staticContent for user msgs
    assert.equal(msg.staticContent, undefined);
});

test('session:message for user creates entity with staticContent', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        messageId: 'm1',
    });
    const msg = state.messages['m1'];
    assert.equal(msg.messageId, 'm1');
    assert.equal(msg.role, 'user');
    assert.equal(msg.staticContent, 'Hello');
    assert.equal(state.sessions.s1.messageIds.includes('m1'), true);
});

test('session:message with parentId stores it', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        messageId: 'm2',
        parentId: 'm1',
    });
    assert.equal(state.messages['m2'].parentId, 'm1');
});

// ── Tool Calls ──

test('session:tool_call creates toolCall entity', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:tool_call', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
    });
    const tc = state.toolCalls['t1'];
    assert.ok(tc);
    assert.equal(tc.toolName, 'read');
    assert.equal(tc.toolId, 't1');
    assert.deepEqual(tc.params, { path: 'file.js' });
});

test('session:tool_call with messageId links to message', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:message_start', { sessionId: 's1', messageId: 'm1', role: 'assistant' });
    dispatch(state, 'session:tool_call', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
        messageId: 'm1',
    });
    assert.equal(state.messages['m1'].toolIds.includes('t1'), true);
});

test('session:tool_result updates toolCall', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
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
    const tc = state.toolCalls['t1'];
    assert.equal(tc.result, 'file content');
    assert.equal(tc.isError, false);
});

test('session:tool_result with error', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
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
    assert.equal(state.toolCalls['t1'].isError, true);
});

test('session:tool_result ignores missing tool call', () => {
    const state = dispatch(freshState(), 'session:tool_result', {
        sessionId: 'nonexistent',
        toolId: 't1',
        result: 'x',
        isError: false,
    });
    assert.equal(state.toolCalls['t1'], undefined);
});

test('session:tool_call with return tracks latestReturn', () => {
    const state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:tool_call', {
        sessionId: 's1',
        toolName: 'return',
        toolId: 'ret-1',
        params: { status: 'ok', reason: 'done' },
    });
    assert.equal(state.sessions.s1.latestReturn.status, 'ok');
});

// ── Multiple sessions are isolated ──

test('multiple sessions are isolated', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    state = dispatch(state, 'session:start', { sessionId: 's2', phase: 'reviewer', retryCount: 0 });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'msg1' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'session:message', {
        sessionId: 's2',
        role: 'user',
        content: [{ type: 'text', text: 'msg2' }],
        messageId: 'm2',
    });
    assert.equal(state.sessions.s1.messageIds.length, 1);
    assert.equal(state.sessions.s2.messageIds.length, 1);
});

test('unknown action type returns state unchanged', () => {
    const state = dispatch(freshState(), 'UNKNOWN', {});
    assert.equal(state.squad.status, 'idle');
});
