import { useReducer, useEffect, useRef } from 'react';
import { eventStore } from '../event-store.js';

/**
 * Subscribe to state changes affecting a specific top-level path.
 * Only re-renders when the matched path has changed since last dispatch.
 */
function usePathState(path, selector) {
    const [, forceUpdate] = useReducer((x) => x + 1, 0);
    const prevRef = useRef(path);

    useEffect(() => {
        prevRef.current = path;
        return eventStore.subscribe((paths) => {
            if (!paths || paths.has(path)) forceUpdate();
        });
    }, [path]);

    return selector(eventStore.getState());
}

/**
 * Subscribes to a single node's state.
 * Only re-renders when `squad` branch changes (node state updates).
 */
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
