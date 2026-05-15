/**
 * Global Event Log (Append-Only) for Event Sourcing.
 * The absolute source of truth — pure business facts only.
 * No transient events, no infrastructure metadata.
 * Every entry has a monotonic id, a virtual tick (engine cycle), event type, and payload.
 *
 * Virtual Tick: replaces Date.now() with a monotonic counter that increments
 * per append. Single-appends advance tick by 1; batch-appends advance tick by 1
 * (all entries in a batch share the same tick — they derive from the same engine pulse).
 *
 * No Date.now() — the system is fully deterministic. EventLog replay on any machine
 * produces byte-identical state trees.
 */
export class EventLog {
    /**
     * @param {Array} initialEntries — pre-existing entries to hydrate from (e.g. .ndjson replay)
     */
    constructor(initialEntries = []) {
        this.log = [...initialEntries];
        this._tick = initialEntries.length;
        this.listeners = new Set();
    }

    /**
     * Current virtual tick (monotonic, 0-based).
     */
    currentTick() {
        return this._tick;
    }

    /**
     * Build an entry skeleton. id is assigned lazily in append/appendBatch.
     * tick is the current virtual clock value at the start of this append cycle.
     */
    _makeEntry(event, payload) {
        return {
            id: -1,
            tick: this._tick,
            event,
            payload,
        };
    }

    /**
     * Append a single event to the log.
     * Advances tick by 1. Notifies all listeners immediately.
     */
    append(event, payload) {
        const entry = this._makeEntry(event, payload);
        entry.id = this.log.length;
        this._tick++;
        this.log.push(entry);
        for (const listener of this.listeners) {
            listener(entry);
        }
        return entry;
    }

    /**
     * Append multiple entries in one atomic batch.
     * All entries get sequential ids but share the same tick value
     * (they were all produced by the same engine pulse).
     * Tick advances by 1 after the batch. Listeners notified once with the array.
     * @param {Array} entries — pre-built entry objects (id will be fixed up)
     */
    appendBatch(entries) {
        if (entries.length === 0) return;
        for (const e of entries) {
            e.id = this.log.length;
            e.tick = this._tick;
            this.log.push(e);
        }
        this._tick++;
        for (const listener of this.listeners) {
            listener(entries);
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
        this._tick = 0;
    }

    get length() {
        return this.log.length;
    }
}
