/**
 * Client-side Event Store — pure business state with projection-reported tracking.
 *
 * Projections declare what they touch via TOUCHES; applyEvent returns the touched keys.
 * EventStore classifies keys as path or entity by presence of ':'.
 * Zero hardcoded PATH_DOMAIN, zero ENTITY_EVENTS mapping.
 */

import { applyEvent, getTouchedKeys, project } from '../shared/projections.js';

class EventStore {
    constructor() {
        this.cursor = 0;
        this.listeners = new Set();
        this.state = project([]);
        this._pathVersions = {};
        this._entityVersions = {};
        this._changedPaths = new Set();
        this._changedEntities = new Set();
    }

    dispatch(type, payload, seq) {
        this._changedPaths.clear();
        this._changedEntities.clear();
        if (seq != null) this.cursor = Math.max(this.cursor, seq + 1);

        applyEvent(this.state, type, payload);
        const touched = getTouchedKeys(type, payload);
        for (const key of touched) {
            if (key.includes(':')) {
                this._entityVersions[key] = (this._entityVersions[key] || 0) + 1;
                this._changedEntities.add(key);
            } else {
                this._pathVersions[key] = (this._pathVersions[key] || 0) + 1;
                this._changedPaths.add(key);
            }
        }
        this._notify();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify() {
        const paths = this._changedPaths;
        const entities = this._changedEntities;
        for (const l of this.listeners) {
            if (l.length >= 2) l(paths, entities);
            else l(paths);
        }
    }

    reset() {
        this.cursor = 0;
        this.state = project([]);
        this._pathVersions = {};
        this._entityVersions = {};
        this._changedPaths.clear();
        this._changedEntities.clear();
        for (const l of this.listeners) l();
    }

    getCursor() {
        return this.cursor;
    }
    getState() {
        return this.state;
    }
    getPathVersion(path) {
        return this._pathVersions[path] || 0;
    }
    getEntityVersion(type, id) {
        return this._entityVersions[`${type}:${id}`] || 0;
    }
}

export { EventStore };
export const eventStore = new EventStore();

if (typeof window !== 'undefined') window.__es = eventStore;
