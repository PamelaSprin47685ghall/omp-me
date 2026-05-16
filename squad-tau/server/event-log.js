/**
 * Pure EventLog — the absolute metric of space-time in Squad-Tau.
 *
 * Every entry carries:
 *  - id:    global monotonically increasing index within the log array.
 *  - tick:  virtual clock; advances once per append (batch entries share one tick).
 *  - event: the fact type (e.g. 'session:start').
 *  - payload: structured data for the fact.
 *
 * No Date.now(), no Math.random(), no file I/O — pure deterministic append.
 * Listeners are notified synchronously on every append/appendBatch.
 */
export class EventLog {
    constructor(initialEntries = []) {
        this._log = [];
        this._nextId = 0;
        this._nextTick = 0;
        this._listeners = new Set();
        // Hydrate from persisted entries (replay)
        for (const e of initialEntries) {
            this._log.push({ ...e });
            if (e.id >= this._nextId) this._nextId = e.id + 1;
            if (e.tick >= this._nextTick) this._nextTick = e.tick + 1;
        }
    }

    get length() {
        return this._log.length;
    }

    get log() {
        return this._log;
    }

    getLog() {
        return this._log;
    }

    get currentTick() {
        return this._nextTick;
    }

    getSince(cursor = 0) {
        return this._log.slice(cursor);
    }

    append(event, payload) {
        const entry = {
            id: this._nextId++,
            tick: this._nextTick++,
            event,
            payload,
        };
        this._log.push(entry);
        for (const fn of this._listeners) fn(entry);
        return entry;
    }

    appendBatch(entries) {
        if (!entries.length) return;
        const tick = this._nextTick;
        const batch = [];
        for (const e of entries) {
            const entry = { id: this._nextId++, tick, event: e.event, payload: e.payload };
            this._log.push(entry);
            batch.push(entry);
        }
        this._nextTick++;
        for (const fn of this._listeners) fn(batch);
    }

    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    reset() {
        this._log.length = 0;
        this._nextId = 0;
        this._nextTick = 0;
    }
}
