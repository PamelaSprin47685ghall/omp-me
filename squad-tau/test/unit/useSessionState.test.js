import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyEvent, getInitialState } from '../../shared/projections.js';

function freshState() {
    return getInitialState();
}

function dispatch(state, type, payload) {
    return applyEvent(state, type, payload);
}

test('returns initial state', () => {
    const state = freshState();
    assert.equal(Object.keys(state.sessions).length, 0);
});

test('SESSION_START adds session and initializes message list', () => {
    const state = dispatch(freshState(), 'session:start', {
        sessionId: 's1',
        nodeId: 'n1',
        phase: 'worker',
        retryCount: 0,
        model: { provider: 'openai', id: 'gpt-4' },
    });
    const session = state.sessions.s1;
    assert.equal(session.nodeId, 'n1');
    assert.equal(session.phase, 'worker');
    assert.equal(session.status, 'active');
    assert.deepEqual(session.messages, []);
});

test('SESSION_START preserves existing messages on re-dispatch', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'session:start', { sessionId: 's1', phase: 'worker' });
    assert.equal(state.sessions.s1.messages.length, 1);
});

test('SESSION_STATE updates session phase and ignores unknown', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'session:state', { sessionId: 's1', phase: 'authoring' });
    assert.equal(state.sessions.s1.phase, 'authoring');

    const st2 = dispatch(state, 'session:state', { sessionId: 'nonexistent', phase: 'authoring' });
    assert.equal(st2.sessions.nonexistent, undefined);
});

test('SESSION_MESSAGE appends message with parentId', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    assert.equal(state.sessions.s1.messages[0].role, 'user');

    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        messageId: 'm2',
        parentId: 'm1',
    });
    assert.equal(state.sessions.s1.messages[1].parentId, 'm1');
});

test('multiple sessions are isolated', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'session:start', { sessionId: 's2', phase: 'reviewer' });
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
    assert.equal(state.sessions.s1.messages.length, 1);
    assert.equal(state.sessions.s2.messages.length, 1);
});

test('SESSION_END updates session status', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'session:end', { sessionId: 's1', reason: 'completed' });
    assert.equal(state.sessions.s1.status, 'completed');

    state = dispatch(state, 'session:end', { sessionId: 's1', reason: 'error', errorMessage: 'timeout' });
    assert.equal(state.sessions.s1.status, 'error');
    assert.equal(state.sessions.s1.errorMessage, 'timeout');

    const st3 = dispatch(state, 'session:end', { sessionId: 'nonexistent', reason: 'completed' });
    assert.equal(st3.sessions.nonexistent, undefined);
});

test('unknown action type returns state unchanged', () => {
    const state = dispatch(freshState(), 'UNKNOWN', {});
    assert.equal(state.squad.status, 'idle');
});
