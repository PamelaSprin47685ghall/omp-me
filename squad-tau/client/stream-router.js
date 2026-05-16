/**
 * StreamRouter — zero-buffer direct DOM streaming via RAF.
 *
 *   register(urn, textNode)   — maps a URN to a live TextNode
 *   unregister(urn)           — removes mapping
 *   dispatch(urn, delta)      — queues text for the next RAF frame
 *
 * No JS string buffers, no .join(''), no text accumulation.
 * Each RAF frame flushes all pending deltas via TextNode.appendData().
 * Early-buffered tokens (arriving before registration) are stored as
 * individual delta entries and replayed when the target registers.
 *
 * GC-friendly: no intermediate string pooling, no long-lived arrays.
 */
export class StreamRouter {
    constructor(scheduler) {
        this._targets = new Map(); // urn → TextNode
        this._pending = []; // [{urn, delta}] — flat RAF queue
        this._early = new Map(); // urn → [delta, …]
        this._rafId = null;
        // Wrap rAF in a lambda via window to preserve the native this-binding (avoids 'Illegal invocation' in strict modules)
        this._scheduler =
            scheduler ||
            (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
                ? (fn) => window.requestAnimationFrame(fn)
                : (fn) => setTimeout(fn, 0));
    }

    register(urn, textNode) {
        this._targets.set(urn, textNode);
        if (this._early.has(urn)) {
            const deltas = this._early.get(urn);
            for (const d of deltas) textNode.appendData(d);
            this._early.delete(urn);
        }
    }

    unregister(urn) {
        this._targets.delete(urn);
        this._early.delete(urn);
    }

    dispatch(urn, delta) {
        if (this._targets.has(urn)) {
            this._pending.push({ urn, delta });
            this._schedule();
        } else {
            const arr = this._early.get(urn);
            if (arr) arr.push(delta);
            else this._early.set(urn, [delta]);
        }
    }

    hasPending(urn) {
        return this._pending.some((e) => e.urn === urn) || (this._early.has(urn) && this._early.get(urn).length > 0);
    }

    _schedule() {
        if (this._rafId) return;
        this._rafId = this._scheduler(() => {
            this._rafId = null;
            this._flush();
        });
    }

    _flush() {
        if (this._pending.length === 0) return;
        // Merge deltas per-URN for this frame (single appendData per URN per frame)
        const merged = new Map();
        for (const { urn, delta } of this._pending) {
            merged.set(urn, (merged.get(urn) || '') + delta);
        }
        for (const [urn, text] of merged) {
            const node = this._targets.get(urn);
            if (node) node.appendData(text);
        }
        this._pending.length = 0;
    }

    // Test hook: run pending flush synchronously
    flushNow() {
        if (this._rafId) {
            // Cancel the scheduled RAF and flush immediately
            if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._flush();
    }
}

export const streamRouter = new StreamRouter();

// Test hook: expose for Puppeteer UI tests
if (typeof window !== 'undefined') window.__streamRouter = streamRouter;
