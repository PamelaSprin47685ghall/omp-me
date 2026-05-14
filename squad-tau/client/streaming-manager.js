/**
 * StreamingManager — RAF-throttled paint scheduler.
 *
 * Does NOT buffer text. Its sole responsibility is coalescing delta
 * notifications into requestAnimationFrame ticks. Components read
 * the latest state from EventStore directly via eventStore.getState().
 *
 * No dual truth. No string concatenation. No Map of buffers.
 */
class StreamingManager {
    constructor() {
        this.events = new EventTarget();
        this.dirty = new Set();
        this.rafId = null;
    }

    emit(messageId, _delta) {
        this.dirty.add(messageId);
        this.events.dispatchEvent(new CustomEvent('global_delta', { detail: { messageId } }));
        if (typeof requestAnimationFrame !== 'undefined') {
            this.scheduleFlush();
        }
    }

    scheduleFlush() {
        if (this.rafId) return;
        const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : setTimeout;
        this.rafId = raf(() => {
            this.rafId = null;
            for (const messageId of this.dirty) {
                this.events.dispatchEvent(new CustomEvent(messageId, { detail: { messageId } }));
            }
            this.dirty.clear();
        });
    }

    subscribe(messageId, handler) {
        const wrapper = (e) => handler(e.detail);
        this.events.addEventListener(messageId, wrapper);
        return () => this.events.removeEventListener(messageId, wrapper);
    }

    clear(messageId) {
        this.dirty.delete(messageId);
    }
}

export const streamingManager = new StreamingManager();
