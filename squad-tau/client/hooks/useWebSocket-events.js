import { useEffect, useRef, useCallback } from 'react';

const ROUTE_TABLE = {
    // Squad events
    'squad:init': 'onSquadInit',
    'squad:node_state': 'onNodeState',
    'squad:complete': 'onSquadComplete',
    'squad:outer_review_start': 'onSquadOuterReviewStart',
    'squad:outer_review_result': 'onSquadOuterReviewResult',
    'squad:abort': 'onSquadAbort',
    // Session events
    'session:start': 'onSessionStart',
    'session:state': 'onSessionState',
    'session:message': 'onSessionMessage',
    'session:message_delta': 'onSessionDelta',
    'session:tool_call': 'onSessionToolCall',
    'session:tool_result': 'onSessionToolResult',
    'session:end': 'onSessionEnd',
    // Model pool events
    'model_pool:snapshot': 'onModelPoolSnapshot',
    'model_pool:changed': 'onModelPoolChanged',
    // Connection events
    'connection:established': 'onConnectionEstablished',
    'connection:close': 'onConnectionClose',
    // Heartbeat events
    ping: 'onPing',
    pong: 'onPong',
    // Error event
    error: 'onError',
};

export function useWsEvents({ ws, handlers }) {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    const eventBus = useRef(Object.assign(Object.create(null), { listeners: new Map() }));

    const emit = useCallback((type, payload) => {
        eventBus.current.listeners.get(type)?.forEach((cb) => cb(payload));
    }, []);

    useEffect(() => {
        if (!ws) return;

        const onMessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            const handlerName = ROUTE_TABLE[msg.type];
            if (handlerName) {
                handlersRef.current[handlerName]?.(msg.payload, msg);
            } else if (process.env.NODE_ENV !== 'production') {
                console.warn(`[useWsEvents] no handler registered for event type: ${msg.type}`);
            }
            emit(msg.type, msg.payload);
        };

        ws.addEventListener('message', onMessage);
        return () => ws.removeEventListener('message', onMessage);
    }, [ws, emit]);

    return {
        eventBus: {
            on: (type, cb) => {
                const bus = eventBus.current;
                if (!bus.listeners.has(type)) bus.listeners.set(type, new Set());
                bus.listeners.get(type).add(cb);
            },
            off: (type, cb) => {
                eventBus.current.listeners.get(type)?.delete(cb);
            },
        },
    };
}
