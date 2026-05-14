import { useSyncExternalStore, useState } from 'react';
import { eventStore } from '../event-store.js';

export function useSessionState() {
    const state = useSyncExternalStore(
        (l) => eventStore.subscribe(l),
        () => eventStore.getState(),
    );
    const [activeSessionId, setActiveSessionId] = useState(null);

    return {
        sessions: state.sessions,
        activeSessionId,
        setActiveSessionId,
        messages: activeSessionId ? state.sessions[activeSessionId]?.messages || [] : [],
        dispatch: (action) => {
            if (action.type === 'SESSION_MESSAGE') {
                eventStore.dispatch('session:message', action.payload);
            }
        },
    };
}
