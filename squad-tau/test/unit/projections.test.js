import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyEvent, getInitialState } from '../../shared/projections.js';

function freshState() {
    return getInitialState();
}

function dispatch(state, type, payload) {
    return applyEvent(state, type, payload);
}

test('Regression: assistant message with parentId should append, not overwrite parent', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        messageId: 'm1',
    });
    assert.equal(state.sessions.s1.messageIds.length, 1, 'Should have 1 message');
    assert.equal(state.sessions.s1.messageIds[0], 'm1');

    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there' }],
        messageId: 'm2',
        parentId: 'm1',
    });
    assert.equal(state.sessions.s1.messageIds.length, 2, 'Should append, resulting in 2 messages');
    assert.equal(state.sessions.s1.messageIds[0], 'm1', 'First message should still be m1');
    assert.equal(state.sessions.s1.messageIds[1], 'm2', 'Second message should be m2');
    assert.equal(state.messages['m2'].parentId, 'm1', 'Second message should have parentId m1');
});

test('Regression: duplicate messageId should overwrite (deduplication)', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Original' }],
        messageId: 'm1',
    });
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Updated' }],
        messageId: 'm1',
    });
    assert.equal(state.sessions.s1.messageIds.length, 1, 'Should still have only 1 message ID');
    assert.equal(state.messages['m1'].staticContent, 'Updated', 'Message staticContent should be updated');
});
