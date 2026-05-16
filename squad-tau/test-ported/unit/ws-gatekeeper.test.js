import { describe, it, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { routeMessage, _skeletonSent } from '../../client/hooks/useWebSocket.js';
import { eventStore, EventStore } from '../../client/event-store.js';
import { streamRouter, StreamRouter } from '../../client/stream-router.js';

class MockTextNode {
    constructor() {
        this.data = '';
        this.appendCount = 0;
    }
    appendData(text) {
        this.data += text;
        this.appendCount++;
    }
}

describe('Edge Gatekeeper — Dual-Track Routing', () => {
    let scheduler, flushNow;
    let mockTextNode;

    beforeEach(() => {
        // Reset event store
        eventStore.reset();
        _skeletonSent.clear();

        // Replace streamRouter with a test-controlled one
        // (StreamRouter is a singleton; we mutate its internal state via reset since
        //  we can't reference it directly. Instead we use a fresh router for assertions.)
    });

    // Helper: create a controlled router for this test
    function freshRouter() {
        let fn = null;
        const r = new StreamRouter((f) => {
            fn = f;
        });
        r._flushNow = () => {
            if (fn) {
                fn();
                r.flushNow();
            }
        };
        return {
            router: r,
            flush: () => {
                if (fn) {
                    fn();
                    r.flushNow();
                }
            },
        };
    }

    // ── Zero Penetration Test ──

    it('zero EventStore penetration for 100 ephemeral delta messages', () => {
        // Reset skeleton tracker so first delta emits skeleton
        _skeletonSent.clear();
        eventStore.reset();

        // Verify initial state
        const preState = eventStore.getState();
        assert.equal(Object.keys(preState.messages || {}).length, 0, 'no messages before test');

        // Send 100 ephemeral delta messages
        for (let i = 0; i < 100; i++) {
            routeMessage({
                c: 'e',
                event: 'message:delta',
                payload: {
                    messageId: 'msg_1',
                    sessionId: 'sess_1',
                    delta: { text: `token${i}`, type: 'text' },
                },
            });
        }

        // EventStore should have exactly 1 message entry (the skeleton from first delta)
        const state = eventStore.getState();
        const messages = state.messages || {};
        const messageIds = Object.keys(messages);

        assert.equal(messageIds.length, 1, `EventStore should have 1 skeleton entry, got ${messageIds.length}`);
        assert.equal(messages.msg_1.status, 'streaming', 'skeleton status is streaming (not finalized)');

        // The message contains NO delta text — text goes to StreamRouter
        assert.equal(messages.msg_1.staticContent, undefined, 'EventStore should NOT contain any delta text');
    });

    // ── Skeleton Trigger Test ──

    it('first ephemeral delta emits exactly one message:start skeleton', () => {
        eventStore.reset();
        _skeletonSent.clear();

        routeMessage({
            c: 'e',
            event: 'message:delta',
            payload: {
                messageId: 'msg_2',
                sessionId: 'sess_2',
                delta: { text: 'first token', type: 'text' },
            },
        });

        let state = eventStore.getState();
        assert.ok(state.messages.msg_2, 'skeleton created');
        assert.equal(state.messages.msg_2.status, 'streaming');
        assert.equal(state.messages.msg_2.sessionId, 'sess_2');

        // Second delta for same messageId should NOT emit another skeleton
        routeMessage({
            c: 'e',
            event: 'message:delta',
            payload: {
                messageId: 'msg_2',
                sessionId: 'sess_2',
                delta: { text: 'second token', type: 'text' },
            },
        });

        state = eventStore.getState();
        assert.equal(Object.keys(state.messages).length, 1, 'only one skeleton entry for this messageId');
    });

    // ── Fact channel routing ──

    it('fact messages update EventStore state', () => {
        eventStore.reset();
        _skeletonSent.clear();

        routeMessage({
            c: 'f',
            event: 'squad:init',
            payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' },
            seq: 0,
        });

        const state = eventStore.getState();
        assert.ok(state.nodes.n1, 'node n1 should exist');
        assert.equal(state.nodes.n1.status, 'authoring');
    });

    // ── Pong is ignored ──

    it('pong messages are silently dropped', () => {
        eventStore.reset();
        const before = eventStore.getState();
        routeMessage({ event: 'pong' });
        const after = eventStore.getState();
        assert.deepEqual(after, before, 'state unchanged after pong');
    });

    // ── Dual track isolation ──

    it('ephemeral and fact channels for same messageId are isolated', () => {
        eventStore.reset();
        _skeletonSent.clear();

        // Send a delta (ephemeral) → skeleton goes to EventStore
        routeMessage({
            c: 'e',
            event: 'message:delta',
            payload: { messageId: 'msg_iso', sessionId: 's_iso', delta: { text: 'hello', type: 'text' } },
        });

        const factState = eventStore.getState();
        assert.equal(factState.messages.msg_iso.status, 'streaming', 'EventStore has skeleton from ephemeral channel');

        // Now send message:finalized (fact channel)
        routeMessage({
            c: 'f',
            event: 'message:finalized',
            payload: { messageId: 'msg_iso', staticContent: 'Hello World' },
            seq: 1,
        });

        const finalState = eventStore.getState();
        assert.equal(finalState.messages.msg_iso.status, 'finalized', 'EventStore updated via fact channel');
        assert.equal(finalState.messages.msg_iso.staticContent, 'Hello World', 'finalized content in EventStore');
    });
});
