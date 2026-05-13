import { useReducer, useState } from 'react';
import { INITIAL_STATE, sessionReducer } from '../session-reducer.js';

export function useSessionState() {
    const [state, dispatch] = useReducer(sessionReducer, INITIAL_STATE);
    const [activeSessionId, setActiveSessionId] = useState(null);
    return {
        sessions: state.sessions,
        activeSessionId,
        setActiveSessionId,
        messages: state.messages,
        dispatch,
    };
}
