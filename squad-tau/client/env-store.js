/**
 * Env Store — infrastructure configuration synced from server.
 * Not part of EventLog; updated via dedicated WebSocket messages.
 * Holds maxWorkers, model slots, and other env-level config.
 */
const listeners = new Set();
let state = { maxWorkers: 3, modelSlots: [] };

export const envStore = {
    getState: () => state,
    update(patch) {
        state = { ...state, ...patch };
        for (const fn of listeners) fn();
    },
    subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
};

if (typeof window !== 'undefined') window.__envStore = envStore;
