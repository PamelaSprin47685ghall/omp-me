/**
 * Env Store — powered by EventStore state.config.
 * Config (maxWorkers) now lives in state.config via config:capacity_changed.
 * This module is maintained as a thin adapter for backward compat;
 * consumers should read from state.config directly.
 */
import { eventStore } from './event-store.js';

const listeners = new Set();
let state = { maxWorkers: 3 };

function sync() {
    const cfg = eventStore.getState().config || { maxWorkers: 3 };
    const next = { maxWorkers: cfg.maxWorkers };
    if (next.maxWorkers !== state.maxWorkers) {
        state = next;
        for (const fn of listeners) fn();
    }
}

// Subscribe to EventStore changes
const unsub = eventStore.subscribe(sync);

export const envStore = {
    getState: () => state,
    update() {
        // No longer supported — dispatch config:capacity_changed via EventLog
    },
    subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
};

if (typeof window !== 'undefined') window.__envStore = envStore;
