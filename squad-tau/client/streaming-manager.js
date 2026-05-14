/**
 * StreamingManager handles high-frequency delta updates bypassing React's state.
 * Implements Double-Buffer Rendering using requestAnimationFrame for 60FPS silkiness.
 */
class StreamingManager {
    constructor() {
        this.events = new EventTarget();
        this.buffers = new Map(); // Full text/thinking buffer
        this.dirty = new Set(); // Message IDs updated since last frame
        this.rafId = null;
    }

    emit(messageId, delta) {
        let buffer = this.buffers.get(messageId);
        if (!buffer) {
            buffer = {
                thinking: '',
                text: '',
                thinkingBatch: '', // Batch for current frame
                textBatch: '', // Batch for current frame
            };
            this.buffers.set(messageId, buffer);
        }

        if (delta.type === 'thinking_delta' || delta.type === 'thinking') {
            buffer.thinking += delta.text;
            buffer.thinkingBatch += delta.text;
        } else {
            buffer.text += delta.text;
            buffer.textBatch += delta.text;
        }

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
                const buffer = this.buffers.get(messageId);
                if (buffer) {
                    // Dispatch batched deltas for the frame
                    this.events.dispatchEvent(
                        new CustomEvent(messageId, {
                            detail: {
                                text: buffer.textBatch,
                                thinking: buffer.thinkingBatch,
                            },
                        }),
                    );
                    buffer.textBatch = '';
                    buffer.thinkingBatch = '';
                }
            }
            this.dirty.clear();
        });
    }

    getBuffer(messageId) {
        return this.buffers.get(messageId) || { thinking: '', text: '' };
    }

    subscribe(messageId, handler) {
        const wrapper = (e) => handler(e.detail);
        this.events.addEventListener(messageId, wrapper);
        return () => this.events.removeEventListener(messageId, wrapper);
    }

    clear(messageId) {
        this.buffers.delete(messageId);
        this.dirty.delete(messageId);
    }
}

export const streamingManager = new StreamingManager();
