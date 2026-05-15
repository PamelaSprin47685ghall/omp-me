/**
 * Global Event Log (Append-Only) for Event Sourcing.
 * The absolute source of truth — pure business facts only.
 * No transient events, no infrastructure metadata.
 * Every entry has a monotonic id and is persisted.
 */
export class EventLog {
    constructor() {
        this.log = [];
        this.listeners = new Set();
    }

    _makeEntry(event, payload) {
        return {
            id: this.log.length,
            event,
            payload,
            timestamp: Date.now(),
        };
    }

    /**
     * Append a single event to the log.
     * Notifies all listeners immediately.
     */
    append(event, payload) {
        const entry = this._makeEntry(event, payload);
        this.log.push(entry);
        for (const listener of this.listeners) {
            listener(entry);
        }
        return entry;
    }

    /**
     * Append multiple entries in one atomic batch.
     * All entries are pushed together, then listeners notified once.
     * @param {Array} entries — pre-built entry objects (with id, event, payload, timestamp)
     */
    appendBatch(entries) {
        if (entries.length === 0) return;
        for (const e of entries) {
            this.log.push(e);
        }
        for (const listener of this.listeners) {
            listener(entries); // passes array when batch
        }
    }

    /**
     * Subscribe to new entries.
     * Listener receives either a single entry or an Array (from appendBatch).
     * @param {Function} listener
     * @returns {Function} unsubscribe function
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getSince(cursor) {
        const index = parseInt(cursor, 10);
        if (isNaN(index)) return this.log;
        return this.log.slice(index);
    }

    reset() {
        this.log = [];
    }

    get length() {
        return this.log.length;
    }
}
