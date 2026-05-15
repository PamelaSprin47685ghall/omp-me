import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyEvent, getInitialState } from '../../shared/projections.js';
import { EventStore } from '../../client/event-store.js';

function freshState() {
    return getInitialState();
}

function dispatch(state, type, payload) {
    const newState = applyEvent(state, type, payload);
    Object.assign(state, newState);
    return state;
}

function createSession(state, sessionId, phase = 'worker', epoch = 0) {
    let s = dispatch(state, 'session:creating', { sessionId, phase, epoch });
    s = dispatch(s, 'session:start', { sessionId, phase, epoch });
    Object.assign(state, s);
}

function createStore() {
    const store = new EventStore();
    store.dispatch('session:creating', { sessionId: 's1', phase: 'worker', epoch: 0 });
    store.dispatch('session:start', { sessionId: 's1', phase: 'worker', epoch: 0 });
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

// latestReturn removed — domain facts (node:review_decided) replace it.
test('tool_call:started no longer tracks latestReturn on session', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'tool_call:started', {
        sessionId: 's1',
        toolName: 'return',
        toolId: 'ret-1',
        params: { status: 'ok', reason: 'done' },
    });
    // latestReturn no longer set
    assert.equal(state.sessions.s1.latestReturn, undefined);
});

// ── Node domain facts ──

test('node:review_decided approved sets node to approved', () => {
    const state = getInitialState();
    dispatch(state, 'squad:init', {
        mode: 'M',
        nodes: [{ id: 'n1', task: 'test', review_criteria: [], depends_on: [] }],
        originalTask: '',
    });
    dispatch(state, 'squad:node_state', { nodeId: 'n1', status: 'reviewing' });
    dispatch(state, 'node:review_decided', {
        nodeId: 'n1',
        sessionId: 's1',
        approved: true,
        summary: 'good work',
    });
    assert.equal(state.squad.nodes.n1.status, 'approved');
    assert.equal(state.squad.nodes.n1.summary, 'good work');
});

test('node:review_decided rejected sets node to rejected', () => {
    const state = getInitialState();
    dispatch(state, 'squad:init', {
        mode: 'M',
        nodes: [{ id: 'n1', task: 'test', review_criteria: [], depends_on: [] }],
        originalTask: '',
    });
    dispatch(state, 'squad:node_state', { nodeId: 'n1', status: 'reviewing' });
    dispatch(state, 'node:review_decided', {
        nodeId: 'n1',
        sessionId: 's1',
        approved: false,
        summary: 'needs work',
    });
    assert.equal(state.squad.nodes.n1.status, 'rejected');
    assert.equal(state.squad.nodes.n1.feedback, 'needs work');
});

test('node:work_submitted advances phase', () => {
    const state = getInitialState();
    dispatch(state, 'squad:init', {
        mode: 'M',
        nodes: [{ id: 'n1', task: 'test', review_criteria: [], depends_on: [] }],
        originalTask: '',
    });
    // n1 starts in authoring (initial wavefront)
    assert.equal(state.squad.nodes.n1.status, 'authoring');
    dispatch(state, 'node:work_submitted', {
        nodeId: 'n1',
        sessionId: 's1',
        summary: 'work done',
        affected_files: ['test.js'],
    });
    assert.equal(state.squad.nodes.n1.status, 'confirming');
    assert.equal(state.squad.nodes.n1.summary, 'work done');
});

// ── config:capacity_changed ──

test('config:capacity_changed updates state.config.maxWorkers', () => {
    const state = freshState();
    dispatch(state, 'config:capacity_changed', { maxWorkers: 5 });
    assert.equal(state.config.maxWorkers, 5);
});

// ── Multiple sessions are isolated ──

test('multiple sessions are isolated', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'session:creating', { sessionId: 's2', phase: 'reviewer', epoch: 0 });
    dispatch(state, 'session:start', { sessionId: 's2', phase: 'reviewer', epoch: 0 });
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

// ── EventStore tracking (structural sharing) ──

test('EventStore structural sharing: unchanged branches keep identity', () => {
    const store = createStore();
    const msgRef = store.getState().messages;
    store.dispatch('session:state', { sessionId: 's1', phase: 'completed' });
    // messages sub-tree was not touched — same reference
    assert.equal(store.getState().messages, msgRef);
});

test('EventStore structural sharing: changed branches get new reference', () => {
    const store = createStore();
    const sessionsRef = store.getState().sessions;
    store.dispatch('session:state', { sessionId: 's1', phase: 'completed' });
    // sessions sub-tree was modified — new reference
    assert.notEqual(store.getState().sessions, sessionsRef);
});
