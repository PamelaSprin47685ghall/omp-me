import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyEvent, getInitialState } from '../../shared/projections.js';

function freshState() {
    return getInitialState();
}

function dispatch(state, type, payload) {
    const newState = applyEvent(state, type, payload);
    Object.assign(state, newState);
    return state;
}

function createSession(state, sessionId, phase = 'worker', retryCount = 0) {
    let s = dispatch(state, 'session:creating', { sessionId, phase, retryCount });
    s = dispatch(s, 'session:start', { sessionId, phase, retryCount });
}

test('returns initial state', () => {
    const state = freshState();
    assert.equal(Object.keys(state.sessions).length, 0);
});

test('session lifecycle: creating → start → state', () => {
    const state = freshState();
    createSession(state, 's1', 'worker', 0);

    const session = state.sessions.s1;
    assert.equal(session.status, 'active');
    assert.equal(session.phase, 'worker');
    assert.equal(session.messageIds.length, 0);

    dispatch(state, 'session:state', { sessionId: 's1', phase: 'completed' });
    assert.equal(state.sessions.s1.phase, 'completed');
    assert.equal(state.sessions.s1.status, 'completed');
});

test('session:end updates session status', () => {
    const state = freshState();
    createSession(state, 's1');
    dispatch(state, 'session:end', { sessionId: 's1', reason: 'completed' });
    assert.equal(state.sessions.s1.status, 'completed');

    dispatch(state, 'session:end', { sessionId: 's1', reason: 'error', errorMessage: 'timeout' });
    assert.equal(state.sessions.s1.status, 'error');
    assert.equal(state.sessions.s1.errorMessage, 'timeout');
});

test('unknown action type returns state unchanged', () => {
    const state = dispatch(freshState(), 'UNKNOWN', {});
    assert.equal(state.squad.status, 'idle');
});
