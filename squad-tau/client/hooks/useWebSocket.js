/**
 * WebSocket hook — edge gateway for Squad-Tau.
 *
 * Responsibilities:
 * 1. Business events → EventStore (single truth path)
 * 2. Delta events → direct DOM method calls on CustomElements
 * 3. Never touches streaming content
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { eventStore } from '../event-store.js';

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RECONNECT_ATTEMPTS = 50;
const PING_INTERVAL = 30000;

function routeDelta(payload) {
    const el = document.querySelector(`agent-message[message-id="${payload.messageId}"]`);
    if (el) el.appendChunk(payload.delta?.text || '', payload.delta?.type || 'text');
}

function routeStreamEnd(payload) {
    const el = document.querySelector(`agent-message[message-id="${payload.messageId}"]`);
    if (el) el.finalize(payload.staticContent || '');
}

export function useWebSocket({ port } = {}) {
    const resolvedPort = port ?? window.location.port;
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const pingIntervalRef = useRef(null);
    const backoffIndexRef = useRef(0);
    const reconnectAttemptsRef = useRef(0);
    const lastPongRef = useRef(true);
    const [connected, setConnected] = useState(false);

    const clearTimers = useCallback(() => {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
    }, []);

    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.onopen = null;
            wsRef.current.onclose = null;
            wsRef.current.onerror = null;
            wsRef.current.onmessage = null;
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    const startPing = useCallback(() => {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
            if (!lastPongRef.current) {
                disconnect();
                return;
            }
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                lastPongRef.current = false;
                wsRef.current.send(JSON.stringify({ type: 'ping' }));
            }
        }, PING_INTERVAL);
    }, [disconnect]);

    const connect = useCallback(() => {
        clearTimers();
        disconnect();

        const ws = new WebSocket(`ws://127.0.0.1:${resolvedPort}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
            setConnected(true);
            backoffIndexRef.current = 0;
            reconnectAttemptsRef.current = 0;
            ws.send(JSON.stringify({ type: 'sync', payload: { cursor: eventStore.getCursor() } }));
            startPing();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'pong') {
                    lastPongRef.current = true;
                    return;
                }

                const { type, payload, seq } = msg;

                // Streaming deltas → direct DOM routing (zero EventStore)
                if (type === 'message:delta') {
                    routeDelta(payload);
                    return;
                }

                // Finalized message → EventStore + DOM finalize
                if (type === 'message:finalized') {
                    eventStore.dispatch(type, payload, seq);
                    routeStreamEnd(payload);
                    return;
                }

                // All other domain events → EventStore
                eventStore.dispatch(type, payload, seq);
            } catch (err) {
                console.error('Failed to parse WebSocket message:', err);
            }
        };

        ws.onerror = () => setConnected(false);

        ws.onclose = () => {
            setConnected(false);
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;

            if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                console.error(`[WebSocket] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`);
                return;
            }

            reconnectAttemptsRef.current++;
            const delay = BACKOFF_STEPS[backoffIndexRef.current];
            if (backoffIndexRef.current < BACKOFF_STEPS.length - 1) backoffIndexRef.current++;
            reconnectTimeoutRef.current = setTimeout(connect, delay);
        };
    }, [port, clearTimers, disconnect, startPing]);

    useEffect(() => {
        connect();
        return () => {
            clearTimers();
            disconnect();
        };
    }, [connect, clearTimers, disconnect]);

    const send = useCallback((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
        }
    }, []);

    return { connected, send };
}
