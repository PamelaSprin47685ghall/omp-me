/**
 * Global Event Log (Append-Only) for Event Sourcing.
 * The absolute source of truth.
 */
export class EventLog {
    constructor() {
        this.log = [];
        this.listeners = new Set();
        this.transientEvents = new Set(['message:delta']);
    }

    /**
     * Append a new event to the log.
     * @param {string} event - Event type
     * @param {object} payload - Event data
     */
    append(event, payload) {
        const entry = {
            id: this.log.length,
            event,
            payload,
            timestamp: Date.now(),
        };

        if (!this.transientEvents.has(event)) {
            this.log.push(entry);
        }

        for (const listener of this.listeners) {
            listener(entry);
        }
    }

    /**
     * Subscribe to new entries.
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
