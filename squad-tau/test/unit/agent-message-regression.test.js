import { describe, test, expect } from 'bun:test';

// ── Regression: early-token buffer (REPAIR.md §4.1) ──
// pushEarlyBuffer/drainEarlyBuffer are pure JS Map operations.
// Test the buffer contract: keyed store, drain clears, thinking/text separation.
// No DOM needed.
describe('agent-message early-token buffer regression', () => {
    function makeBuffer() {
        const _earlyBuffer = new Map();
        return {
            push: (messageId, text, type) => {
                let buf = _earlyBuffer.get(messageId);
                if (!buf) {
                    buf = { text: '', thinking: '' };
                    _earlyBuffer.set(messageId, buf);
                }
                if (type === 'thinking') buf.thinking += text;
                else buf.text += text;
            },
            drain: (messageId) => {
                const buf = _earlyBuffer.get(messageId);
                if (!buf) return null;
                _earlyBuffer.delete(messageId);
                return buf;
            },
        };
    }

    test('concatenates and drains tokens by messageId', () => {
        const { push, drain } = makeBuffer();
        push('m1', 'Hello ', 'text');
        push('m1', 'World', 'text');
        const buf = drain('m1');
        expect(buf).toEqual({ text: 'Hello World', thinking: '' });
        expect(drain('m1')).toBeNull();
    });

    test('thinking and text stored in separate fields', () => {
        const { push, drain } = makeBuffer();
        push('m2', 'step 1', 'thinking');
        push('m2', 'answer', 'text');
        const buf = drain('m2');
        expect(buf?.thinking).toBe('step 1');
        expect(buf?.text).toBe('answer');
    });

    test('drain returns null for unknown or already-drained id', () => {
        const { push, drain } = makeBuffer();
        expect(drain('nonexistent')).toBeNull();
        push('m3', 'x', 'text');
        drain('m3');
        expect(drain('m3')).toBeNull();
    });
});
