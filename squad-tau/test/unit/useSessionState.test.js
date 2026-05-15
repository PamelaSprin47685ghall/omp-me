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

test('session:start adds session with messageIds array', () => {
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
    assert.deepEqual(session.messageIds, []);
});

test('session:start preserves existing messageIds on re-dispatch', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    assert.equal(state.sessions.s1.messageIds.length, 1);
});

test('session:state updates session phase and ignores unknown', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    state = dispatch(state, 'session:state', { sessionId: 's1', phase: 'authoring' });
    assert.equal(state.sessions.s1.phase, 'authoring');

    const st2 = dispatch(state, 'session:state', { sessionId: 'nonexistent', phase: 'authoring' });
    assert.equal(st2.sessions.nonexistent, undefined);
});

test('session:end updates session status', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
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
