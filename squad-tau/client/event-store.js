/**
 * Client-side Event Store — pure domain state with structural sharing.
 *
 * applyEvent returns a NEW state reference with structural sharing:
 * unchanged sub-trees keep their identity (===).
 * React components use useSyncExternalStore + React.memo for O(1) render filtering.
 *
 * Zero manual change tracking — no TOUCHES, no path versions, no entity versions.
 */

import { applyEvent, getInitialState } from '../shared/projections.js';

class EventStore {
    constructor() {
        this.cursor = 0;
        this.listeners = new Set();
        this.state = getInitialState();
        this._busyCount = 0;
    }

    dispatch(type, payload, seq) {
        this._busyCount++;
        try {
            if (seq != null) this.cursor = Math.max(this.cursor, seq + 1);
            this.state = applyEvent(this.state, type, payload);
        } finally {
            this._busyCount--;
        }
        for (const l of this.listeners) l();
    }

    /** True when all dispatches have been applied (no busy work pending). */
    isIdle() {
        return this._busyCount === 0;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    reset() {
        this.cursor = 0;
        this.state = getInitialState();
        for (const l of this.listeners) l();
    }

    getCursor() {
        return this.cursor;
    }
    getState() {
        return this.state;
    }
}

export { EventStore };
export const eventStore = new EventStore();

if (typeof window !== 'undefined') window.__es = eventStore;
