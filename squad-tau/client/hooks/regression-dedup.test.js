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
    // 1. Start session
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });

    // 2. Add user message (m1)
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        messageId: 'm1',
    });

    assert.equal(state.sessions.s1.messages.length, 1, 'Should have 1 message');
    assert.equal(state.sessions.s1.messages[0].messageId, 'm1');

    // 3. Add assistant message (m2) replying to m1 (parentId: 'm1')
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there' }],
        messageId: 'm2',
        parentId: 'm1',
    });

    const messages = state.sessions.s1.messages;
    assert.equal(messages.length, 2, 'Should append assistant message, resulting in 2 messages total');
    assert.equal(messages[0].messageId, 'm1', 'First message should still be m1');
    assert.equal(messages[1].messageId, 'm2', 'Second message should be m2');
    assert.equal(messages[1].parentId, 'm1', 'Second message should have parentId m1');
});

test('Regression: duplicate messageId should overwrite (deduplication)', () => {
    let state = dispatch(freshState(), 'session:start', { sessionId: 's1', phase: 'worker' });

    // Initial message
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Original' }],
        messageId: 'm1',
    });

    // Same messageId, different content
    state = dispatch(state, 'session:message', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Updated' }],
        messageId: 'm1',
    });

    const messages = state.sessions.s1.messages;
    assert.equal(messages.length, 1, 'Should still have only 1 message');
    assert.equal(messages[0].content[0].text, 'Updated', 'Message content should be updated');
});
