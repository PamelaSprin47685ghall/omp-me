import { useReducer, useCallback, useRef } from 'react';

export const INITIAL_STATE = {
    slots: [],
    isOpen: false,
};

function modelPoolReducer(state, action) {
    switch (action.type) {
        case 'model_pool:snapshot':
        case 'model_pool:changed':
            return {
                ...state,
                slots: (action.payload.slots || []).map((s) => ({
                    ...s,
                    slotId: s.slotId || Math.random().toString(36).slice(2, 10),
                })),
            };
        case 'drawer:open':
            return { ...state, isOpen: true };
        case 'drawer:close':
            return { ...state, isOpen: false };
        default:
            return state;
    }
}

export function useModelPool() {
    const [state, dispatch] = useReducer(modelPoolReducer, INITIAL_STATE);
    const sendRef = useRef(null);

    const openDrawer = useCallback(() => {
        dispatch({ type: 'drawer:open' });
    }, []);

    const closeDrawer = useCallback(() => {
        dispatch({ type: 'drawer:close' });
    }, []);

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
        slots: state.slots,
        isOpen: state.isOpen,
        openDrawer,
        closeDrawer,
        updateSlot,
        sendModelPoolUpdate,
        dispatch,
    };
}
