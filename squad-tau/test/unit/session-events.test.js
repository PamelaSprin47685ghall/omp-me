import { describe, test, expect } from 'bun:test';
import { EventBus } from '../../server/event-bus.js';
import { subscribeToSessionEvents } from '../../server/session-events.js';

function createMockSession() {
    const subscribers = [];
    return {
        subscribe(callback) {
            subscribers.push(callback);
            return () => {
                const idx = subscribers.indexOf(callback);
                if (idx !== -1) subscribers.splice(idx, 1);
            };
        },
        emit(event) {
            for (const sub of subscribers) sub(event);
        },
    };
}

describe('subscribeToSessionEvents', () => {
    test('forwards text_delta as session:message_delta', () => {
        const bus = new EventBus();
        const session = createMockSession();
        const events = [];
        bus.on('session:message_delta', (payload) => events.push(payload));

        const unsub = subscribeToSessionEvents(session, bus, 'session-1');

        session.emit({
            type: 'message_update',
            message: { id: 'msg-1' },
            assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
        });

        expect(events.length).toBe(1);
        expect(events[0].sessionId).toBe('session-1');
        expect(events[0].messageId).toBe('msg-1');
        expect(events[0].delta.type).toBe('text_delta');
        expect(events[0].delta.text).toBe('Hello');

        unsub();
    });

    test('forwards thinking_delta as session:message_delta', () => {
        const bus = new EventBus();
        const session = createMockSession();
        const events = [];
        bus.on('session:message_delta', (payload) => events.push(payload));

        subscribeToSessionEvents(session, bus, 'session-2');

        session.emit({
            type: 'message_update',
            message: { id: 'msg-2' },
            assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking...' },
        });

        expect(events.length).toBe(1);
        expect(events[0].delta.type).toBe('thinking_delta');
        expect(events[0].delta.text).toBe('thinking...');
    });

    test('forwards tool_execution_start as session:tool_call', () => {
        const bus = new EventBus();
        const session = createMockSession();
        const events = [];
        bus.on('session:tool_call', (payload) => events.push(payload));

        subscribeToSessionEvents(session, bus, 'session-3');

        session.emit({
            type: 'tool_execution_start',
            toolName: 'read',
            toolId: 'call-1',
            input: { path: 'file.js' },
        });

        expect(events.length).toBe(1);
        expect(events[0].sessionId).toBe('session-3');
        expect(events[0].toolName).toBe('read');
        expect(events[0].toolId).toBe('call-1');
        expect(events[0].params.path).toBe('file.js');
    });

    test('forwards tool_execution_end as session:tool_result', () => {
        const bus = new EventBus();
        const session = createMockSession();
        const events = [];
        bus.on('session:tool_result', (payload) => events.push(payload));

        subscribeToSessionEvents(session, bus, 'session-4');

        session.emit({
            type: 'tool_execution_end',
            toolId: 'call-2',
            result: { content: 'file contents' },
            isError: false,
        });

        expect(events.length).toBe(1);
        expect(events[0].sessionId).toBe('session-4');
        expect(events[0].toolId).toBe('call-2');
        expect(events[0].result.content).toBe('file contents');
        expect(events[0].isError).toBe(false);
    });

    test('forwards message_end as session:message', () => {
        const bus = new EventBus();
        const session = createMockSession();
        const events = [];
        bus.on('session:message', (payload) => events.push(payload));

        subscribeToSessionEvents(session, bus, 'session-5');

        session.emit({
            type: 'message_end',
            message: {
                id: 'msg-final',
                role: 'assistant',
                content: [{ type: 'text', text: 'done' }],
                parentId: 'parent-1',
            },
        });

        expect(events.length).toBe(1);
        expect(events[0].sessionId).toBe('session-5');
        expect(events[0].role).toBe('assistant');
        expect(events[0].messageId).toBe('msg-final');
        expect(events[0].parentId).toBe('parent-1');
    });

    test('unsubscribe stops forwarding', () => {
        const bus = new EventBus();
        const session = createMockSession();
        const events = [];

        const unsub = subscribeToSessionEvents(session, bus, 's');
        bus.on('session:message', (payload) => events.push(payload));

        unsub();

        session.emit({
            type: 'message_end',
            message: { id: 'm1', role: 'assistant', content: [] },
        });

        expect(events.length).toBe(0);
    });

    test('ignores unknown event types', () => {
        const bus = new EventBus();
        const session = createMockSession();
        const events = [];
        bus.on('*', (payload, type) => events.push(type));

        subscribeToSessionEvents(session, bus, 's');

        session.emit({ type: 'unknown_event' });
        session.emit({ type: 'session_start' });
        session.emit({ type: 'turn_start' });

        expect(events.length).toBe(0);
    });
});
