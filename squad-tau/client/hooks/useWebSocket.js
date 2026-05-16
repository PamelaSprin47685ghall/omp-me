/**
 * Edge Gatekeeper — dual-track WebSocket routing.
 *
 *   c:'f' (fact)     → EventStore (domain truth → React updates)
 *   c:'e' (ephemeral)→ StreamRouter (direct DOM, bypasses React)
 *
 * On the first ephemeral delta for a messageId, a `message:start`
 * skeleton fact is emitted to EventStore, giving React a placeholder
 * to render before any tokens arrive.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { eventStore } from '../event-store.js';
import { streamRouter } from '../stream-router.js';

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RECONNECT_ATTEMPTS = 50;
const PING_INTERVAL = 30000;

// Tracks which messageIds have had their skeleton emitted
export const _skeletonSent = new Set();

/**
 * Route an ephemeral (delta) message — pure side-effect function.
 * Emits skeleton `message:start` on first delta, then routes text to StreamRouter.
 */
export function routeEphemeral(event, payload) {
    if (event === 'message:delta') {
        if (payload.messageId && !_skeletonSent.has(payload.messageId)) {
            _skeletonSent.add(payload.messageId);
            eventStore.dispatch('message:start', {
                messageId: payload.messageId,
                sessionId: payload.sessionId || '',
            });
        }
        if (payload.delta && payload.delta.text) {
            streamRouter.dispatch(payload.messageId, payload.delta.text);
        }
    }
}

/**
 * Route a fact message to EventStore.
 */
export function routeFact(type, payload, seq) {
    eventStore.dispatch(type, payload, seq);
}

/**
 * Route any parsed message through the dual-track system.
 * Testable entry point for the gatekeeper.
 */
export function routeMessage(msg) {
    if (msg.event === 'pong') return;

    // ── Ephemeral channel — bypasses EventStore ──
    if (msg.c === 'e') {
        routeEphemeral(msg.event, msg.payload);
        return;
    }

    // ── Fact channel — EventStore only ──
    routeFact(msg.event, msg.payload, msg.seq);
}

// ── React Hook ──

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
                routeMessage(JSON.parse(event.data));
            } catch {
                /* malformed */
            }
        };

        ws.onerror = () => setConnected(false);

        ws.onclose = () => {
            setConnected(false);
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
            if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
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
