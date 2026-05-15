import { useSyncExternalStore, useCallback } from 'react';
import { eventStore } from '../event-store.js';
import { uiStore } from '../ui-store.js';
import { envStore } from '../env-store.js';

const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

// Bound subscribe functions — avoid `this` loss when passed as callbacks
const sub = (cb) => eventStore.subscribe(cb);
const subUi = (cb) => uiStore.subscribe(cb);
const subEnv = (cb) => envStore.subscribe(cb);

/**
 * Subscribe to domain state with structural sharing.
 */
export function useStore(selector) {
    return useSyncExternalStore(sub, () => selector(eventStore.getState()));
}

/**
 * Subscribe to a single top-level state path.
 */
export function usePathState(path, selector) {
    return useSyncExternalStore(sub, () => selector(eventStore.getState()));
}

function identity(v) {
    return v;
}

/**
 * Subscribe to the squad nodes map (stable reference via structural sharing).
 */
export function useNodes() {
    return usePathState('squad', (s) => s.squad.nodes || EMPTY_OBJECT);
}

export function useSessions() {
    return usePathState('sessions', (s) => s.sessions || EMPTY_OBJECT);
}

export function useResults() {
    return usePathState('squad', (s) => s.squad.results || EMPTY_ARRAY);
}

/**
 * Subscribe to a single node in the squad nodes map.
 */
export function useNodeState(nodeId) {
    return useSyncExternalStore(sub, () => eventStore.getState().squad.nodes[nodeId]);
}

/**
 * Subscribe to a single message entity by messageId.
 */
export function useMessageState(messageId) {
    return useSyncExternalStore(sub, () => eventStore.getState().messages[messageId] || EMPTY_OBJECT);
}

/**
 * Subscribe to a single toolCall entity by toolId.
 */
export function useToolCallState(toolId) {
    return useSyncExternalStore(sub, () => eventStore.getState().toolCalls[toolId] || EMPTY_OBJECT);
}

/**
 * Subscribe to a single session entity by sessionId.
 */
export function useSessionState(sessionId) {
    return useSyncExternalStore(sub, () => eventStore.getState().sessions[sessionId] || EMPTY_OBJECT);
}

/**
 * Subscribe to a session's message IDs array.
 */
export function useSessionMessageIds(sessionId) {
    const session = useSessionState(sessionId);
    return session.messageIds || EMPTY_ARRAY;
}

/**
 * Subscribe to UI store (viewport state, not domain).
 */
export function useUiState(selector) {
    return useSyncExternalStore(
        subUi,
        () => selector(uiStore.getState()),
        () => selector({ viewMode: 'dag', activeSessionId: null, drawerOpen: false, bannerDismissed: false }),
    );
}

/**
 * Subscribe to environment configuration (server-infrastructure metadata).
 */
export function useEnv(selector) {
    return useSyncExternalStore(
        subEnv,
        () => selector(envStore.getState()),
        () => selector({ maxWorkers: 3 }),
    );
}
