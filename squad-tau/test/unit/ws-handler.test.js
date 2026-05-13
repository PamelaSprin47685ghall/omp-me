import { describe, test, expect, beforeEach } from 'bun:test';
import { EventBus } from '../../server/event-bus.js';
import * as sessionRegistry from '../../server/session-registry.js';

// Import and test routeMessage
import { routeMessage } from '../../server/ws-handler.js';

function createMockWs() {
    const sent = [];
    return {
        sent,
        readyState: 1,
        send: (data) => sent.push(data),
    };
}

describe('routeMessage', () => {
    let eventBus;
    let modelPool;
    let configModule;

    beforeEach(() => {
        eventBus = new EventBus();
        modelPool = {
            getSlots: () => [],
            addSlot: () => {},
            removeSlot: () => {},
            updateSlotThinkingLevel: () => {},
        };
        configModule = {
            saveModelsConfig: async () => {},
            loadModelsConfig: () => [],
        };
    });

    test('returns false for unknown message type', async () => {
        const ws = createMockWs();
        const result = await routeMessage({ type: 'unknown:type', payload: {} }, modelPool, configModule, eventBus, ws);
        expect(result).toBe(false);
    });

    test('returns false for missing type', async () => {
        const ws = createMockWs();
        const result = await routeMessage({ payload: {} }, modelPool, configModule, eventBus, ws);
        expect(result).toBe(false);
    });

    test('handles ping with pong response', async () => {
        const ws = createMockWs();
        const result = await routeMessage({ type: 'ping' }, modelPool, configModule, eventBus, ws);
        expect(result).toBe(true);
        expect(ws.sent.length).toBe(1);
        const pong = JSON.parse(ws.sent[0]);
        expect(pong.type).toBe('pong');
    });

    test('handles abort by emitting squad:abort event', async () => {
        const ws = createMockWs();
        const events = [];
        eventBus.on('squad:abort', (payload) => events.push(payload));

        const result = await routeMessage(
            { type: 'abort', payload: { reason: 'user request' } },
            modelPool,
            configModule,
            eventBus,
            ws,
        );
        expect(result).toBe(true);
        expect(events.length).toBe(1);
        expect(events[0].reason).toBe('user request');
    });

    test('session:user_message returns error for non-existent session', async () => {
        const ws = createMockWs();
        const result = await routeMessage(
            { type: 'session:user_message', payload: { sessionId: 'nonexistent', text: 'hello', messageId: 'msg-1' } },
            modelPool,
            configModule,
            eventBus,
            ws,
        );
        expect(result).toBe(true);
        expect(ws.sent.length).toBe(1);
        const err = JSON.parse(ws.sent[0]);
        expect(err.type).toBe('error');
        expect(err.payload.message).toContain('not active');
    });

    test('session:user_message returns error for missing sessionId or text', async () => {
        const ws = createMockWs();
        const result = await routeMessage(
            { type: 'session:user_message', payload: { sessionId: 's1' } },
            modelPool,
            configModule,
            eventBus,
            ws,
        );
        expect(result).toBe(true);
        expect(ws.sent.length).toBe(1);
        const err = JSON.parse(ws.sent[0]);
        expect(err.payload.message).toContain('Invalid');
    });

    test('session:user_message routes to active session', async () => {
        const ws = createMockWs();
        const received = [];
        sessionRegistry.register('active-session', {
            sendUserMessage: (text) => {
                received.push(text);
            },
            status: 'active',
        });

        const result = await routeMessage(
            {
                type: 'session:user_message',
                payload: { sessionId: 'active-session', text: 'hello agent', messageId: 'msg-2' },
            },
            modelPool,
            configModule,
            eventBus,
            ws,
        );
        expect(result).toBe(true);
        expect(received).toEqual(['hello agent']);
        sessionRegistry.unregister('active-session');
    });

    test('session:user_message broadcasts session:message to eventBus', async () => {
        const ws = createMockWs();
        const events = [];
        eventBus.on('session:message', (payload) => events.push(payload));

        sessionRegistry.register('s1', { sendUserMessage: () => {}, status: 'active' });

        await routeMessage(
            { type: 'session:user_message', payload: { sessionId: 's1', text: 'hi', messageId: 'msg-3' } },
            modelPool,
            configModule,
            eventBus,
            ws,
        );

        expect(events.length).toBe(1);
        expect(events[0].sessionId).toBe('s1');
        expect(events[0].role).toBe('user');
        expect(events[0].content[0].text).toBe('hi');
        sessionRegistry.unregister('s1');
    });
});
