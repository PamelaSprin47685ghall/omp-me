import { useSyncExternalStore, useCallback, useRef, useState } from 'react';
import { eventStore } from '../event-store.js';

export function useModelPool() {
    const state = useSyncExternalStore(
        (l) => eventStore.subscribe(l),
        () => eventStore.getState(),
    );

    const [isOpen, setIsOpen] = useState(false);
    const sendRef = useRef(null);

    const openDrawer = useCallback(() => setIsOpen(true), []);
    const closeDrawer = useCallback(() => setIsOpen(false), []);

    const updateSlot = useCallback((action, slot, slotId, thinkingLevel) => {
        if (!sendRef.current) {
            console.warn('WebSocket send not wired, cannot update model pool');
            return;
        }
        sendRef.current({
            type: 'model_pool:update',
            payload: { action, slot, slotId, thinkingLevel },
        });
    }, []);

    const sendModelPoolUpdate = useCallback((send) => {
        sendRef.current = send;
    }, []);

    return {
        slots: state.modelPool.slots,
        isOpen,
        openDrawer,
        closeDrawer,
        updateSlot,
        sendModelPoolUpdate,
        dispatch: (action) => {
            if (action.type.startsWith('model_pool:')) {
                eventStore.dispatch(action.type, action.payload);
            }
        },
    };
}
