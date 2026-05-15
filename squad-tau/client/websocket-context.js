import { createContext, useContext } from 'react';

export const WebSocketContext = createContext({ connected: false, send: () => {} });

export function useWebSocketContext() {
    return useContext(WebSocketContext);
}
