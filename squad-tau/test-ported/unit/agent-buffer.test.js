import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';

/**
 * Early buffer read-only semantics.
 * StreamRouter buffers tokens before the <stream-sink> element mounts.
 * read() must NOT delete data (remount-safe), delete() is explicit.
 */
describe('stream buffer — read-only semantics', () => {
    function makeBuffer() {
        const store = new Map();
        return {
            push: (messageId, text, type) => {
                let buf = store.get(messageId);
                if (!buf) {
                    buf = { text: '', thinking: '' };
                    store.set(messageId, buf);
                }
                if (type === 'thinking') buf.thinking += text;
                else buf.text += text;
            },
            read: (messageId) => {
                const buf = store.get(messageId);
                return buf ? { ...buf } : null;
            },
            delete: (messageId) => {
                store.delete(messageId);
            },
            has: (messageId) => store.has(messageId),
        };
    }

    it('push then read returns buffered data without deleting', () => {
        const buf = makeBuffer();
        buf.push('m1', 'Hello ', 'text');
        buf.push('m1', 'World', 'text');
        const first = buf.read('m1');
        assert.deepEqual(first, { text: 'Hello World', thinking: '' });
        const second = buf.read('m1');
        assert.deepEqual(second, { text: 'Hello World', thinking: '' });
    });

    it('push more after read — accumulated content still accessible', () => {
        const buf = makeBuffer();
        buf.push('m1', 'Hello ', 'text');
        const first = buf.read('m1');
        assert.equal(first.text, 'Hello ');
        buf.push('m1', 'World', 'text');
        const second = buf.read('m1');
        assert.equal(second.text, 'Hello World');
    });

    it('thinking and text stored in separate fields', () => {
        const buf = makeBuffer();
        buf.push('m2', 'step 1', 'thinking');
        buf.push('m2', 'answer', 'text');
        const data = buf.read('m2');
        assert.equal(data.thinking, 'step 1');
        assert.equal(data.text, 'answer');
    });

    it('delete removes data, subsequent read returns null', () => {
        const buf = makeBuffer();
        buf.push('m3', 'data', 'text');
        assert.ok(buf.has('m3'));
        buf.delete('m3');
        assert.ok(!buf.has('m3'));
        assert.equal(buf.read('m3'), null);
    });

    it('read returns null for unknown id', () => {
        const buf = makeBuffer();
        assert.equal(buf.read('nonexistent'), null);
    });

    it('delete on unknown id does not throw', () => {
        const buf = makeBuffer();
        assert.doesNotThrow(() => buf.delete('unknown'));
    });

    it('full lifecycle: push → read → push more → read → delete → gone', () => {
        const buf = makeBuffer();
        buf.push('m4', 'Early ', 'text');
        buf.push('m4', 'thinking...', 'thinking');
        const mount1 = buf.read('m4');
        assert.equal(mount1.text, 'Early ');
        assert.equal(mount1.thinking, 'thinking...');
        assert.ok(buf.has('m4'));
        buf.push('m4', 'more ', 'text');
        buf.push('m4', 'tokens', 'text');
        const mount2 = buf.read('m4');
        assert.equal(mount2.text, 'Early more tokens');
        assert.equal(mount2.thinking, 'thinking...');
        buf.delete('m4');
        assert.ok(!buf.has('m4'));
        assert.equal(buf.read('m4'), null);
    });
});
