import { useSyncExternalStore } from 'react';
import { eventStore } from '../event-store.js';

const EMPTY_ARRAY = [];

/**
 * Subscribe to a single top-level state path.
 * Uses React 18 useSyncExternalStore for tear-free external store sync.
 */
export function usePathState(path, selector) {
    return useSyncExternalStore(
        (callback) =>
            eventStore.subscribe((paths) => {
                if (!paths || paths.has(path)) callback();
            }),
        () => selector(eventStore.getState()),
    );
}

export function useNodeState(nodeId) {
    return usePathState('squad', (s) => s.squad.nodes[nodeId]);
}

export function useSessionMessages(sessionId) {
    return usePathState('sessions', (s) => {
        const sess = s.sessions[sessionId];
        return sess ? sess.messages : EMPTY_ARRAY;
    });
}
