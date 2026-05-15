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

test('Regression: assistant message with parentId should append, not overwrite parent', () => {
    let state = freshState();
    dispatch(state, 'session:creating', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });

    // User message: created + finalized with content
    dispatch(state, 'message:created', {
        messageId: 'm1',
        sessionId: 's1',
        role: 'user',
        staticContent: 'Hello',
    });
    dispatch(state, 'message:finalized', {
        messageId: 'm1',
        staticContent: 'Hello',
    });
    assert.equal(state.sessions.s1.messageIds.length, 1, 'Should have 1 message');
    assert.equal(state.sessions.s1.messageIds[0], 'm1');

    // Assistant message: created + finalized with parentId
    dispatch(state, 'message:created', {
        messageId: 'm2',
        sessionId: 's1',
        role: 'assistant',
        parentId: 'm1',
    });
    dispatch(state, 'message:finalized', {
        messageId: 'm2',
    });

    assert.equal(state.sessions.s1.messageIds.length, 2, 'Should append, resulting in 2 messages');
    assert.equal(state.sessions.s1.messageIds[0], 'm1', 'First message should still be m1');
    assert.equal(state.sessions.s1.messageIds[1], 'm2', 'Second message should be m2');
    assert.equal(state.messages['m2'].parentId, 'm1', 'Second message should have parentId m1');
});

test('Regression: duplicate messageId should be deduplicated via message:created + message:finalized', () => {
    let state = freshState();
    dispatch(state, 'session:creating', { sessionId: 's1', phase: 'worker', retryCount: 0 });
    dispatch(state, 'session:start', { sessionId: 's1', phase: 'worker', retryCount: 0 });

    // Create message once
    dispatch(state, 'message:created', {
        messageId: 'm1',
        sessionId: 's1',
        role: 'user',
        staticContent: 'Original',
    });
    // Finalize with updated content
    dispatch(state, 'message:finalized', {
        messageId: 'm1',
        staticContent: 'Updated',
    });

    assert.equal(state.sessions.s1.messageIds.length, 1, 'Should still have only 1 message ID');
    assert.equal(state.messages['m1'].staticContent, 'Updated', 'Message staticContent should be updated');
});
