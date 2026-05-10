import { useReducer, useState } from 'react';
import { INITIAL_STATE, sessionReducer } from '../session-reducer.js';

export function useSessionState() {
    const [state, dispatch] = useReducer(sessionReducer, INITIAL_STATE);
    const [activeSessionId, setActiveSessionId] = useState(null);
    return {
        sessions: Object.fromEntries(state.sessions),
        activeSessionId,
        setActiveSessionId,
        messages: Object.fromEntries(state.messages),
        dispatch,
    };
}
