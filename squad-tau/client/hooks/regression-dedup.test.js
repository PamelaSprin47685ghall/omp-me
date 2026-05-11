import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sessionReducer, INITIAL_STATE } from '../session-reducer.js';

function dispatch(state, type, payload) {
    return sessionReducer(state, { type, payload });
}

test('Regression: assistant message with parentId should append, not overwrite parent', () => {
    // 1. Start session
    let state = dispatch(INITIAL_STATE, 'SESSION_START', { sessionId: 's1', phase: 'worker' });

    // 2. Add user message (m1)
    const userMsg = {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        messageId: 'm1',
    };
    state = dispatch(state, 'SESSION_MESSAGE', userMsg);

    assert.equal(state.messages.get('s1').length, 1, 'Should have 1 message');
    assert.equal(state.messages.get('s1')[0].messageId, 'm1');

    // 3. Add assistant message (m2) replying to m1 (parentId: 'm1')
    // Previously, this would overwrite m1 because it used parentId for deduplication
    const assistantMsg = {
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there' }],
        messageId: 'm2',
        parentId: 'm1',
    };
    state = dispatch(state, 'SESSION_MESSAGE', assistantMsg);

    const messages = state.messages.get('s1');
    assert.equal(messages.length, 2, 'Should append assistant message, resulting in 2 messages total');
    assert.equal(messages[0].messageId, 'm1', 'First message should still be m1');
    assert.equal(messages[1].messageId, 'm2', 'Second message should be m2');
    assert.equal(messages[1].parentId, 'm1', 'Second message should have parentId m1');
});

test('Regression: duplicate messageId should overwrite (deduplication)', () => {
    let state = dispatch(INITIAL_STATE, 'SESSION_START', { sessionId: 's1', phase: 'worker' });

    // Initial message
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Original' }],
        messageId: 'm1',
    });

    // Same messageId, different content
    state = dispatch(state, 'SESSION_MESSAGE', {
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Updated' }],
        messageId: 'm1',
    });

    const messages = state.messages.get('s1');
    assert.equal(messages.length, 1, 'Should still have only 1 message');
    assert.equal(messages[0].content[0].text, 'Updated', 'Message content should be updated');
});
