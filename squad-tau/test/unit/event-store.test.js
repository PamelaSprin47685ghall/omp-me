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

function createSession(state, sessionId, phase = 'worker', retryCount = 0) {
    dispatch(state, 'session:creating', { sessionId, phase, retryCount });
    dispatch(state, 'session:start', { sessionId, phase, retryCount });
}

function createStore() {
    const store = new EventStore();
    store.dispatch('session:creating', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    store.dispatch('session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    return store;
}

// ── Message Lifecycle ──

test('message:created creates message entity and appends to session', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'message:created', {
        messageId: 'm1',
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

test('message:created with staticContent creates user message', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'message:created', {
        messageId: 'm1',
        sessionId: 's1',
        role: 'user',
        staticContent: 'Hello world',
    });
    assert.equal(state.messages['m1'].staticContent, 'Hello world');
    assert.equal(state.messages['m1'].role, 'user');
});

test('message:finalized sets status to finalized', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'message:created', {
        messageId: 'm1',
        sessionId: 's1',
        role: 'assistant',
    });
    assert.equal(state.messages['m1'].status, 'created');
    dispatch(state, 'message:finalized', {
        messageId: 'm1',
    });
    assert.equal(state.messages['m1'].status, 'finalized');
});

test('message:finalized with staticContent sets it only when provided', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'message:created', {
        messageId: 'm1',
        sessionId: 's1',
        role: 'assistant',
    });
    dispatch(state, 'message:finalized', {
        messageId: 'm1',
        staticContent: 'Final text',
    });
    assert.equal(state.messages['m1'].staticContent, 'Final text');
});

// ── Message lifecycle via message:created + message:finalized ──

test('message:created + message:finalized creates finalized message', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'message:created', {
        messageId: 'm1',
        sessionId: 's1',
        role: 'assistant',
    });
    dispatch(state, 'message:finalized', {
        messageId: 'm1',
        staticContent: 'final text',
    });
    const msg = state.messages['m1'];
    assert.equal(msg.messageId, 'm1');
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.status, 'finalized');
    assert.equal(msg.staticContent, 'final text');
});

test('message:created with parentId stores it', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'message:created', {
        messageId: 'm1',
        sessionId: 's1',
        role: 'user',
        staticContent: 'hello',
    });
    dispatch(state, 'message:finalized', { messageId: 'm1', staticContent: 'hello' });
    dispatch(state, 'message:created', {
        messageId: 'm2',
        sessionId: 's1',
        role: 'assistant',
        parentId: 'm1',
    });
    dispatch(state, 'message:finalized', { messageId: 'm2' });
    assert.equal(state.messages['m2'].parentId, 'm1');
});

// ── Tool Calls ──

test('tool_call:started creates toolCall entity', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'tool_call:started', {
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

test('tool_call:started with messageId links to message', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'message:created', { messageId: 'm1', sessionId: 's1', role: 'assistant' });
    dispatch(state, 'tool_call:started', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
        messageId: 'm1',
    });
    assert.equal(state.messages['m1'].toolIds.includes('t1'), true);
});

test('tool_call:finished updates toolCall', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'tool_call:started', {
        sessionId: 's1',
        toolName: 'read',
        toolId: 't1',
        params: { path: 'file.js' },
    });
    dispatch(state, 'tool_call:finished', {
        toolId: 't1',
        result: 'file content',
        isError: false,
    });
    const tc = state.toolCalls['t1'];
    assert.equal(tc.result, 'file content');
    assert.equal(tc.isError, false);
});

test('tool_call:finished with error', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'tool_call:started', {
        sessionId: 's1',
        toolName: 'bash',
        toolId: 't1',
        params: { command: 'rm -rf /' },
    });
    dispatch(state, 'tool_call:finished', {
        toolId: 't1',
        result: 'permission denied',
        isError: true,
    });
    assert.equal(state.toolCalls['t1'].isError, true);
});

test('tool_call:started with return tracks latestReturn', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'tool_call:started', {
        sessionId: 's1',
        toolName: 'return',
        toolId: 'ret-1',
        params: { status: 'ok', reason: 'done' },
    });
    assert.equal(state.sessions.s1.latestReturn.status, 'ok');
});

// ── Multiple sessions are isolated ──

test('multiple sessions are isolated', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'session:creating', { sessionId: 's2', phase: 'reviewer', retryCount: 0 });
    dispatch(state, 'session:start', { sessionId: 's2', phase: 'reviewer', retryCount: 0 });
    dispatch(state, 'message:created', { messageId: 'm1', sessionId: 's1', role: 'user', staticContent: 'msg1' });
    dispatch(state, 'message:finalized', { messageId: 'm1', staticContent: 'msg1' });
    dispatch(state, 'message:created', { messageId: 'm2', sessionId: 's2', role: 'user', staticContent: 'msg2' });
    dispatch(state, 'message:finalized', { messageId: 'm2', staticContent: 'msg2' });
    assert.equal(state.sessions.s1.messageIds.length, 1);
    assert.equal(state.sessions.s2.messageIds.length, 1);
});

test('unknown action type returns state unchanged', () => {
    const state = dispatch(freshState(), 'UNKNOWN', {});
    assert.equal(state.squad.status, 'idle');
});

// ── EventStore tracking tests ──

test('EventStore dispatch tracks path versions', () => {
    const store = createStore();
    const v0 = store.getPathVersion('sessions');
    store.dispatch('session:state', { sessionId: 's1', phase: 'completed' });
    assert.equal(store.getPathVersion('sessions'), v0 + 1);
});

test('EventStore dispatch tracks entity versions', () => {
    const store = createStore();
    const v0 = store.getEntityVersion('sessions', 's1');
    store.dispatch('session:state', { sessionId: 's1', phase: 'error' });
    assert.equal(store.getEntityVersion('sessions', 's1'), v0 + 1);
});

test('EventStore subscribe receives paths and entities', () => {
    const store = createStore();
    let recPaths, recEntities;
    store.subscribe((paths, entities) => {
        recPaths = paths;
        recEntities = entities;
    });
    store.dispatch('session:state', { sessionId: 's1', phase: 'completed' });
    assert.ok(recPaths);
    assert.ok(recPaths.size > 0);
    assert.ok(recEntities);
    assert.ok(recEntities.size > 0);
});
