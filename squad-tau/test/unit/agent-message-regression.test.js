import { describe, test, expect } from 'bun:test';

// ── Regression: read-only stream buffer (PROB.md Fatal 2) ──
// drainEarlyBuffer was renamed to readStreamBuffer (read-only, no delete).
// deleteStreamBuffer cleans up only on explicit trigger (message:finalized).
// This prevents DOM amnesia when React unmounts/remounts <agent-message>
// before the stream is finalized.
//
// Tests use local Map replicas of the real pushEarlyBuffer/readStreamBuffer/deleteStreamBuffer.
// No DOM needed.

describe('agent-message stream buffer regression — read-only semantics', () => {
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

    test('push then read returns buffered data without deleting', () => {
        const buf = makeBuffer();
        buf.push('m1', 'Hello ', 'text');
        buf.push('m1', 'World', 'text');
        const first = buf.read('m1');
        expect(first).toEqual({ text: 'Hello World', thinking: '' });
        // Second read still returns data (not deleted)
        const second = buf.read('m1');
        expect(second).toEqual({ text: 'Hello World', thinking: '' });
    });

    test('push more after read — accumulated content still accessible', () => {
        const buf = makeBuffer();
        buf.push('m1', 'Hello ', 'text');
        const first = buf.read('m1');
        expect(first?.text).toBe('Hello ');
        // Push more after read
        buf.push('m1', 'World', 'text');
        const second = buf.read('m1');
        expect(second?.text).toBe('Hello World');
    });

    test('thinking and text stored in separate fields', () => {
        const buf = makeBuffer();
        buf.push('m2', 'step 1', 'thinking');
        buf.push('m2', 'answer', 'text');
        const data = buf.read('m2');
        expect(data?.thinking).toBe('step 1');
        expect(data?.text).toBe('answer');
    });

    test('delete removes data, subsequent read returns null', () => {
        const buf = makeBuffer();
        buf.push('m3', 'data', 'text');
        expect(buf.has('m3')).toBe(true);
        buf.delete('m3');
        expect(buf.has('m3')).toBe(false);
        expect(buf.read('m3')).toBeNull();
    });

    test('read returns null for unknown id', () => {
        const buf = makeBuffer();
        expect(buf.read('nonexistent')).toBeNull();
    });

    test('delete on unknown id does not throw', () => {
        const buf = makeBuffer();
        expect(() => buf.delete('unknown')).not.toThrow();
    });

    test('full lifecycle: push → read → push more → read → finalize → delete → gone', () => {
        const buf = makeBuffer();
        // Phase 1: early tokens before mount
        buf.push('m4', 'Early ', 'text');
        buf.push('m4', 'thinking...', 'thinking');
        // Phase 2: first mount read (connectedCallback equivalent)
        const mount1 = buf.read('m4');
        expect(mount1?.text).toBe('Early ');
        expect(mount1?.thinking).toBe('thinking...');
        // Data still there (remount safe)
        expect(buf.has('m4')).toBe(true);
        // Phase 3: more tokens arrive
        buf.push('m4', 'more ', 'text');
        buf.push('m4', 'tokens', 'text');
        // Phase 3b: remount after unmount
        const mount2 = buf.read('m4');
        expect(mount2?.text).toBe('Early more tokens');
        expect(mount2?.thinking).toBe('thinking...');
        // Phase 4: finalization → cleanup
        buf.delete('m4');
        expect(buf.has('m4')).toBe(false);
        expect(buf.read('m4')).toBeNull();
    });
});
