import { useSyncExternalStore } from 'react';
import { eventStore } from '../event-store.js';

const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

/**
 * Subscribe to a single top-level state path.
 * Uses integer path version for stable snapshots.
 */
export function usePathState(path, selector) {
    useSyncExternalStore(
        (callback) =>
            eventStore.subscribe((paths) => {
                if (!paths || paths.has(path)) callback();
            }),
        () => eventStore.getPathVersion(path),
    );

    return selector(eventStore.getState());
}

/**
 * Subscribe to a single node in the squad nodes map.
 */
export function useNodeState(nodeId) {
    return usePathState('squad', (s) => s.squad.nodes[nodeId]);
}

/**
 * Subscribe to a single message entity by messageId.
 * Only re-renders when that specific message changes.
 */
export function useMessageState(messageId) {
    useSyncExternalStore(
        (callback) =>
            eventStore.subscribe((_paths, entities) => {
                if (!entities) callback();
                else if (entities.has(`messages:${messageId}`)) callback();
            }),
        () => eventStore.getEntityVersion('messages', messageId),
    );

    return eventStore.getState().messages[messageId] || EMPTY_OBJECT;
}

/**
 * Subscribe to a single toolCall entity by toolId.
 * Only re-renders when that specific tool call changes.
 */
export function useToolCallState(toolId) {
    useSyncExternalStore(
        (callback) =>
            eventStore.subscribe((_paths, entities) => {
                if (!entities) callback();
                else if (entities.has(`toolCalls:${toolId}`)) callback();
            }),
        () => eventStore.getEntityVersion('toolCalls', toolId),
    );

    return eventStore.getState().toolCalls[toolId] || EMPTY_OBJECT;
}

/**
 * Subscribe to a single session entity by sessionId.
 */
export function useSessionState(sessionId) {
    useSyncExternalStore(
        (callback) =>
            eventStore.subscribe((_paths, entities) => {
                if (!entities) callback();
                else if (entities.has(`sessions:${sessionId}`)) callback();
            }),
        () => eventStore.getEntityVersion('sessions', sessionId),
    );

    return eventStore.getState().sessions[sessionId] || EMPTY_OBJECT;
}

/**
 * Subscribe to a session's message IDs array.
 * Re-renders only when messageIds changes (new message added).
 */
export function useSessionMessageIds(sessionId) {
    const session = useSessionState(sessionId);
    return session.messageIds || EMPTY_ARRAY;
}
