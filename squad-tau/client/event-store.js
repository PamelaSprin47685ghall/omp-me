import { applyEvent, project } from '../shared/projections.js';

/**
 * Event-type to top-level state-path mapping via domain prefix routing.
 * No dictionary to maintain — the namespace before ':' IS the path.
 *   `squad:*`        → 'squad'
 *   `session:*`      → 'sessions'
 *   `model_pool:*`   → 'modelPool'
 *   `ui:*`           → 'ui'
 */

/**
 * Client-side Event Store with path-tracked notifications.
 * Subscribers receive a Set of changed top-level state paths.
 */
class EventStore {
    constructor() {
        this.cursor = 0;
        this.listeners = new Set();
        this.state = project([]);
        this._changedPaths = new Set();
    }

    _trackPath(type) {
        const domain = type.split(':')[0];
        const path = domain === 'session' ? 'sessions' : domain === 'model_pool' ? 'modelPool' : domain;
        this._changedPaths.add(path);
    }

    dispatch(type, payload, seq) {
        this._changedPaths.clear();

        if (seq != null) {
            this.cursor = Math.max(this.cursor, seq + 1);
        }

        applyEvent(this.state, type, payload);
        if (type !== 'session:message_delta' && type !== 'session:thinking_delta') {
            this._trackPath(type);
            this._notify();
        }
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify() {
        const paths = this._changedPaths;
        this.listeners.forEach((l) => {
            if (l.length === 0) l();
            else l(paths);
        });
    }

    reset() {
        this.cursor = 0;
        this.state = project([]);
        this._changedPaths.clear();
        // Force-update all subscribers — no path filter on reset
        this.listeners.forEach((l) => l());
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
