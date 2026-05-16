/**
 * UI Store — all UI state flows through EventStore as facts.
 *
 * No useState for viewport state. Components subscribe via useSyncExternalStore.
 * The UI domain is a separate slice in the state tree, folded by the
 * same projections engine as the domain state (referential transparency).
 *
 * Convention: UI facts are prefixed `ui:` and live in `state.ui`.
 */
import { eventStore } from './event-store.js';

export const uiStore = {
    getState() {
        const s = eventStore.getState();
        return s.ui || {};
    },

    dispatch(type, payload) {
        eventStore.dispatch(type, payload);
    },

    subscribe(fn) {
        return eventStore.subscribe(fn);
    },
};
