import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { StreamRouter } from '../../client/stream-router.js';

// Mock TextNode for DOM-independent testing
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

describe('StreamRouter — Zero-Buffer Routing', () => {
    // ── Early Buffer: tokens before registration ──

    it('buffers deltas when target not yet registered, flushes on register', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        // Dispatch 5 tokens BEFORE registration
        router.dispatch('urn:msg:1', 'Hello ');
        router.dispatch('urn:msg:1', 'World');
        router.dispatch('urn:msg:1', '! ');
        router.dispatch('urn:msg:1', 'How ');
        router.dispatch('urn:msg:1', 'are you?');

        // Not yet flushed (no RAF run yet)
        assert.ok(router.hasPending('urn:msg:1'), 'should have pending early tokens');

        // Simulate <stream-sink> mounting
        const node = new MockTextNode();
        router.register('urn:msg:1', node);

        // Node should have ALL 5 tokens immediately (no RAF needed for early buffer flush)
        assert.equal(node.data, 'Hello World! How are you?');
        assert.equal(node.appendCount, 5, 'each early delta should be individually appended');
        assert.ok(!router.hasPending('urn:msg:1'), 'all early tokens consumed');

        // Subsequent tokens after registration go through RAF
        router.dispatch('urn:msg:1', ' More');
        assert.ok(router.hasPending('urn:msg:1'), 'should have pending RAF delta');
    });

    // ── RAF Batching: bulk tokens coalesced ──

    it('batches 1000 tokens across 10 URNs into at most 10 appendData calls', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        // Register 10 targets
        const nodes = {};
        for (let i = 0; i < 10; i++) {
            nodes[i] = new MockTextNode();
            router.register(`urn:${i}`, nodes[i]);
        }

        // Dispatch 1000 tokens (100 per URN) in one synchronous batch
        for (let i = 0; i < 1000; i++) {
            const urnIdx = i % 10;
            router.dispatch(`urn:${urnIdx}`, `token${i}`);
        }

        // Flush the RAF queue
        router.flushNow();

        // Each URN should have received exactly 1 appendData call
        let totalAppends = 0;
        for (let i = 0; i < 10; i++) {
            assert.equal(nodes[i].appendCount, 1, `URN ${i} should have 1 appendData, got ${nodes[i].appendCount}`);
            totalAppends += nodes[i].appendCount;
        }

        assert.ok(totalAppends < 1000, `Total appendData calls ${totalAppends} should be << 1000 (RAF-batched)`);
        assert.equal(totalAppends, 10, `Exactly 10 appendData calls (1 per URN), got ${totalAppends}`);
    });

    // ── Single URN batching ──

    it('merges multiple deltas to same URN in one appendData', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        const node = new MockTextNode();
        router.register('urn:x', node);

        router.dispatch('urn:x', 'a');
        router.dispatch('urn:x', 'b');
        router.dispatch('urn:x', 'c');

        router.flushNow();

        assert.equal(node.appendCount, 1, 'all deltas merged into 1 appendData');
        assert.equal(node.data, 'abc', 'merged text correct');
    });

    // ── Unregister clears mappings ──

    it('unregister removes target and early buffer', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        router.dispatch('urn:orphan', 'lost');
        assert.ok(router.hasPending('urn:orphan'), 'early buffered');

        router.unregister('urn:orphan');
        assert.ok(!router.hasPending('urn:orphan'), 'cleared after unregister');
    });

    // ── Zero string concatenation in dispatch path ──

    it('dispatch stores individual deltas without joining (zero buffer)', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        const node = new MockTextNode();
        router.register('urn:z', node);

        // Dispatch deltas one at a time — each is a separate entry in _pending
        router.dispatch('urn:z', 'x');
        router.dispatch('urn:z', 'y');

        // _pending should have 2 entries (not 1 merged string)
        assert.equal(router._pending.length, 2, 'each delta stored individually');

        // After flush, _pending is cleared
        router.flushNow();
        assert.equal(router._pending.length, 0, 'pending cleared after flush');
    });

    // ── Round 6: URN Interleaved Streaming — causal isolation ──

    it('URN isolation: two URNs interleaved receive only their own tokens', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        const nodeA = new MockTextNode();
        const nodeB = new MockTextNode();
        router.register('urn:block:A', nodeA);
        router.register('urn:block:B', nodeB);

        // Interleaved dispatch: A1, B1, A2, B2
        router.dispatch('urn:block:A', 'Hello ');
        router.dispatch('urn:block:B', 'World ');
        router.dispatch('urn:block:A', 'from ');
        router.dispatch('urn:block:B', 'outside');

        router.flushNow();

        assert.equal(nodeA.data, 'Hello from ', 'A gets only its tokens');
        assert.equal(nodeB.data, 'World outside', 'B gets only its tokens');
        // Verify no cross-contamination
        assert.ok(!nodeA.data.includes('World'));
        assert.ok(!nodeB.data.includes('Hello'));
    });

    it('out-of-order dispatch: URN-B before URN-A, each TextNode isolated', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        const nodeA = new MockTextNode();
        const nodeB = new MockTextNode();

        // Dispatch B's tokens BEFORE A is registered
        router.dispatch('urn:block:B', 'B-first ');
        router.dispatch('urn:block:B', 'B-second');

        // Now register A — A's tokens haven't been dispatched yet
        router.register('urn:block:A', nodeA);

        // Dispatch A's tokens
        router.dispatch('urn:block:A', 'A-only');

        // Register B late — early buffer flush
        router.register('urn:block:B', nodeB);

        router.flushNow();

        assert.equal(nodeA.data, 'A-only', 'A has no B contamination');
        assert.equal(nodeB.data, 'B-first B-second', 'B gets its early tokens');
        assert.ok(!nodeA.data.includes('B'));
    });

    it('interleaved text→tool→text: three URNs remain causally isolated', () => {
        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        // Simulates: text token → tool call marker → more text
        // URNs: urn:block:1 (text), urn:block:2 (tool), urn:block:3 (text)
        const node1 = new MockTextNode();
        const node2 = new MockTextNode();
        const node3 = new MockTextNode();
        router.register('urn:block:1', node1);
        router.register('urn:block:2', node2);
        router.register('urn:block:3', node3);

        // Simulate real interleaved streaming pattern
        router.dispatch('urn:block:1', 'First ');
        router.dispatch('urn:block:2', 'read(file)');
        router.dispatch('urn:block:1', 'text ');
        router.dispatch('urn:block:3', 'After ');
        router.dispatch('urn:block:2', 'write(result)');
        router.dispatch('urn:block:3', 'tool ');
        router.dispatch('urn:block:1', 'block');
        router.dispatch('urn:block:3', 'text');

        router.flushNow();

        assert.equal(node1.data, 'First text block', 'text block 1 correct');
        assert.equal(node2.data, 'read(file)write(result)', 'tool block correct');
        assert.equal(node3.data, 'After tool text', 'text block 2 correct');
    });

    it('causal ordering: global appendData trace preserves URN causal sequence', () => {
        // Global trace across all URNs — records the physical appendData order
        const trace = [];
        class TracedNode {
            constructor(urn) {
                this.urn = urn;
                this.data = '';
            }
            appendData(text) {
                this.data += text;
                trace.push({ urn: this.urn, text });
            }
        }

        let flushFn = null;
        const scheduler = (fn) => {
            flushFn = fn;
        };
        const router = new StreamRouter(scheduler);

        const n1 = new TracedNode('urn:a');
        const n2 = new TracedNode('urn:b');
        router.register('urn:a', n1);
        router.register('urn:b', n2);

        // Dispatch: n1, n1, n2 → trace must be [n1, n1, n2]
        router.dispatch('urn:a', 'Hello ');
        router.dispatch('urn:a', 'World');
        router.dispatch('urn:b', 'Second');

        router.flushNow();

        assert.equal(trace.length, 2, '2 appendData calls (merged: 1 per URN)');
        assert.equal(trace[0].urn, 'urn:a', 'first appendData is urn:a');
        assert.equal(trace[1].urn, 'urn:b', 'second appendData is urn:b');
        assert.equal(trace[0].text, 'Hello World', 'urn:a gets merged tokens');
        assert.equal(trace[1].text, 'Second', 'urn:b gets its token');
    });
});
