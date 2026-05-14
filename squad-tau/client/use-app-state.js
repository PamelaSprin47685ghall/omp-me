import { useReducer, useEffect } from 'react';
import { eventStore } from './event-store.js';

export function useAppState(selector) {
    const [, forceUpdate] = useReducer((x) => x + 1, 0);

    useEffect(() => {
        return eventStore.subscribe(forceUpdate);
    }, []);

    return selector(eventStore.getState());
}
