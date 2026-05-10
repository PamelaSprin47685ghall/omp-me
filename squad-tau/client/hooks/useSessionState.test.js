import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sessionReducer, INITIAL_STATE } from '../session-reducer.js';

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
    let state = dispatch(INITIAL_STATE, 'SESSION_START', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'SESSION_START', { sessionId: 's1', phase: 'worker' });
    assert.equal(state.messages.get('s1').length, 1);
});

test('SESSION_STATE updates session phase and ignores unknown', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'SESSION_STATE', { sessionId: 's1', phase: 'authoring' });
    assert.equal(state.sessions.get('s1').phase, 'authoring');

    const st2 = dispatch(state, 'SESSION_STATE', { sessionId: 'nonexistent', phase: 'authoring' });
    assert.equal(st2.sessions.get('nonexistent'), undefined);
});

test('SESSION_MESSAGE appends message with parentId', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        messageId: 'm1',
    });
    assert.equal(state.messages.get('s1')[0].role, 'user');

    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        messageId: 'm2',
        parentId: 'm1',
    });
    assert.equal(state.messages.get('s1')[1].parentId, 'm1');
});

test('multiple sessions are isolated', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'SESSION_START', { sessionId: 's2', phase: 'reviewer' });
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
});

test('SESSION_END updates session status', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', { sessionId: 's1', phase: 'worker' });
    state = dispatch(state, 'SESSION_END', { sessionId: 's1', reason: 'completed' });
    assert.equal(state.sessions.get('s1').status, 'completed');

    state = dispatch(state, 'SESSION_END', { sessionId: 's1', reason: 'error', errorMessage: 'timeout' });
    assert.equal(state.sessions.get('s1').status, 'error');
    assert.equal(state.sessions.get('s1').errorMessage, 'timeout');

    const st3 = dispatch(state, 'SESSION_END', { sessionId: 'nonexistent', reason: 'completed' });
    assert.equal(st3.sessions.get('nonexistent'), undefined);
});

test('unknown action type returns state unchanged', () => {
    assert.equal(dispatch(INITIAL_STATE, 'UNKNOWN', {}), INITIAL_STATE);
});
