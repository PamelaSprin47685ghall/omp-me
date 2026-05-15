/**
 * WebSocket hook — edge gateway for Squad-Tau.
 *
 * Dual-track protocol:
 *   c:'f' (fact channel) → EventStore (domain truth)
 *   c:'e' (ephemeral channel) → direct DOM CustomElement routing
 *
 * Ephemeral events have no seq and never touch EventStore.
 * Fact events carry seq and are foldable into the domain state tree.
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

                // Pong response (no channel — legacy)
                if (msg.event === 'pong') {
                    lastPongRef.current = true;
                    return;
                }

                // ── Dual-track routing ──
                // c field is REQUIRED — no backward compat default
                if (msg.c === 'e') {
                    // Ephemeral channel: direct DOM routing, zero EventStore
                    const { event, payload } = msg;
                    if (event === 'message:delta') {
                        routeDelta(payload);
                    }
                    return;
                }

                // Fact channel: biz logic
                const { event: type, payload, seq } = msg;

                if (type === 'message:finalized') {
                    eventStore.dispatch(type, payload, seq);
                    routeStreamEnd(payload);
                    return;
                }

                // Everything else → EventStore (config:capacity_changed included)
                eventStore.dispatch(type, payload, seq);
            } catch {
                // malformed message, skip
            }
        };

        ws.onerror = () => setConnected(false);

        ws.onclose = () => {
            setConnected(false);
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;

            if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
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
