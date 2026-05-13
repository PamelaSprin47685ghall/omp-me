import { useReducer, useState } from 'react';
import { INITIAL_STATE, sessionReducer } from '../session-reducer.js';

const EMPTY_MAP = new Map();

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
