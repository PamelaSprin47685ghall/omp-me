import { useSyncExternalStore } from 'react';
import { eventStore } from '../event-store.js';

export default function useSquadState() {
    const state = useSyncExternalStore(
        (l) => eventStore.subscribe(l),
        () => eventStore.getState(),
    );

    // Return nodes as native array — no Map conversion
    return {
        squad: state.squad.mode ? state.squad : null,
        nodes: state.squad.nodes,
        results: state.squad.results,
        outerReview: state.squad.outerReview,
        dispatch: (action) => {
            // Optimistic updates for squad if needed
        },
    };
}
