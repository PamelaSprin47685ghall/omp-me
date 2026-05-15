import { useEffect, useRef, useCallback, useState } from 'react';
import { eventStore } from '../event-store.js';

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RECONNECT_ATTEMPTS = 50;
const PING_INTERVAL = 30000;

/**
 * Delta event types — NEVER enter EventStore.
 * Routed directly to document CustomEvents for CustomElement consumption.
 */
const DELTA_TYPES = new Set(['session:message_delta', 'session:thinking_delta']);

/**
 * Track which messageIds have started streaming, to avoid
 * duplicate entity:created calls and identify first-delta.
 */
const _streamingStarts = new Set();

export function useWebSocket({ port } = {}) {
    const resolvedPort = port != null ? port : window.location.port;
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

                // ── Delta events: NEVER enter EventStore ──
                // Routed directly to document CustomEvents.
                // The FIRST delta for a messageId also creates the entity
                // in EventStore so React renders <agent-message>.
                if (DELTA_TYPES.has(type)) {
                    const { sessionId, messageId } = payload;
                    const key = `${sessionId}:${messageId}`;
                    const isFirst = !_streamingStarts.has(key);
                    if (isFirst) {
                        _streamingStarts.add(key);
                        eventStore.dispatch('entity:created', {
                            entityType: 'message',
                            entityId: messageId,
                            sessionId,
                            role: 'assistant',
                        });
                    }

                    document.dispatchEvent(
                        new CustomEvent('delta', {
                            detail: {
                                messageId,
                                sessionId,
                                type: type === 'session:thinking_delta' ? 'thinking' : 'text',
                                text: payload.delta?.text || '',
                            },
                        }),
                    );
                    return;
                }

                // ── session:message (final message fact) ──
                // Dispatches stream:end for the custom element,
                // then enters EventStore as entity:finalized.
                if (type === 'session:message') {
                    const { sessionId, messageId, role, content } = payload;

                    if (role === 'user') {
                        const text = extractText(content);
                        eventStore.dispatch('entity:created', {
                            entityType: 'message',
                            entityId: messageId,
                            sessionId,
                            role,
                            parentId: payload.parentId,
                            staticContent: text,
                        });
                        document.dispatchEvent(
                            new CustomEvent('stream:end', {
                                detail: { messageId, sessionId, text },
                            }),
                        );
                    } else {
                        // Assistant message finalization
                        const text = extractText(content);
                        eventStore.dispatch('entity:finalized', {
                            entityType: 'message',
                            entityId: messageId,
                            sessionId,
                            staticContent: text || undefined,
                        });
                        document.dispatchEvent(
                            new CustomEvent('stream:end', {
                                detail: { messageId, sessionId, text: text || undefined },
                            }),
                        );
                    }
                    return;
                }

                // ── session:message_start (legacy, from server) ──
                if (type === 'session:message_start') {
                    eventStore.dispatch('entity:created', {
                        entityType: 'message',
                        entityId: payload.messageId,
                        sessionId: payload.sessionId,
                        role: payload.role || 'assistant',
                    });
                    return;
                }

                // ── Tool events ──
                if (type === 'session:tool_call') {
                    eventStore.dispatch(type, payload, seq);
                    document.dispatchEvent(
                        new CustomEvent('tool:start', {
                            detail: {
                                toolId: payload.toolId,
                                toolName: payload.toolName,
                                params: payload.params,
                                sessionId: payload.sessionId,
                                messageId: payload.messageId,
                            },
                        }),
                    );
                    return;
                }

                if (type === 'session:tool_result') {
                    eventStore.dispatch(type, payload, seq);
                    document.dispatchEvent(
                        new CustomEvent('tool:update', {
                            detail: {
                                toolId: payload.toolId,
                                result: payload.result,
                                isError: payload.isError,
                            },
                        }),
                    );
                    return;
                }

                // ── All other business events → EventStore directly ──
                eventStore.dispatch(type, payload, seq);
            } catch (err) {
                console.error('Failed to parse WebSocket message:', err);
            }
        };

        ws.onerror = () => {
            setConnected(false);
        };

        ws.onclose = () => {
            setConnected(false);
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;

            if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                console.error(`[WebSocket] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping.`);
                return;
            }

            reconnectAttemptsRef.current++;
            const delay = BACKOFF_STEPS[backoffIndexRef.current];
            if (backoffIndexRef.current < BACKOFF_STEPS.length - 1) {
                backoffIndexRef.current++;
            }

            reconnectTimeoutRef.current = setTimeout(connect, delay);
        };
    }, [port, clearTimers, disconnect, startPing]);

    useEffect(() => {
        // Clear streaming set on reconnection
        _streamingStarts.clear();
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

function extractText(content) {
    if (!content) return '';
    const blocks = Array.isArray(content) ? content : [content];
    const tb = blocks.find((b) => b.type === 'text');
    return tb ? tb.text : '';
}
