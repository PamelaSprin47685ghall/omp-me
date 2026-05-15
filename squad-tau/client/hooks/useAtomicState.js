import { useReducer, useEffect } from 'react';
import { eventStore } from '../event-store.js';

/**
 * Subscribes to a single node's state.
 * Only re-renders when `squad` branch changes (node state updates).
 */
export function usePathState(path, selector) {
    const [, forceUpdate] = useReducer((x) => x + 1, 0);

    useEffect(() => {
        return eventStore.subscribe((paths) => {
            if (!paths || paths.has(path)) forceUpdate();
        });
    }, [path]);

    return selector(eventStore.getState());
}

export function useNodeState(nodeId) {
    return usePathState('squad', (s) => s.squad.nodes[nodeId]);
}

/**
 * Subscribes to a single session's messages.
 * Only re-renders when `sessions` branch changes.
 */
export function useSessionMessages(sessionId) {
    return usePathState('sessions', (s) => {
        const sess = s.sessions[sessionId];
        return sess?.messages || [];
    });
}
