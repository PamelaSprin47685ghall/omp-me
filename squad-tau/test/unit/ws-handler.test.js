import { describe, test, expect, beforeEach } from 'bun:test';
import { EventLog } from '../../server/event-log.js';
import { routeMessage } from '../../server/ws-handler.js';
import { Events } from '../../shared/events.js';

function createMockWs() {
    const sent = [];
    return {
        sent,
        readyState: 1,
        send: (data) => sent.push(data),
    };
}

describe('routeMessage', () => {
    let eventLog;
    let configModule;

    beforeEach(() => {
        eventLog = new EventLog();
        configModule = {
            saveModelsConfig: async () => {},
            loadModelsConfig: () => [],
        };
    });

    test('returns false for unknown message type', async () => {
        const ws = createMockWs();
        const result = await routeMessage({ type: 'unknown:type', payload: {} }, configModule, eventLog, ws);
        expect(result).toBe(false);
    });

    test('handles ping with pong response', async () => {
        const ws = createMockWs();
        const result = await routeMessage({ type: 'ping' }, configModule, eventLog, ws);
        expect(result).toBe(true);
        expect(ws.sent.length).toBe(1);
        const pong = JSON.parse(ws.sent[0]);
        expect(pong.type).toBe('pong');
    });

    test('sync strategy calls eventLog.getSince', async () => {
        const ws = createMockWs();
        let cursorPassed = null;
        eventLog.getSince = (c) => {
            cursorPassed = c;
            return [{ event: 'test:event', payload: { ok: true }, id: 42, timestamp: 123 }];
        };

        const result = await routeMessage({ type: 'sync', payload: { cursor: 10 } }, configModule, eventLog, ws);
        expect(result).toBe(true);
        expect(cursorPassed).toBe(10);
        expect(ws.sent.length).toBe(1);
        const msg = JSON.parse(ws.sent[0]);
        expect(msg.type).toBe('test:event');
        expect(msg.seq).toBe(42);
    });

    test('session:user_message requires active session', async () => {
        const ws = createMockWs();
        eventLog.append(Events.SESSION_START, { sessionId: 's1', nodeId: 'n1', phase: 'worker' });

        const result = await routeMessage(
            { type: 'session:user_message', payload: { sessionId: 's1', text: 'hello', messageId: 'm1' } },
            configModule,
            eventLog,
            ws,
        );
        expect(result).toBe(true);
    });

    test('abort appends squad:abort to eventLog', async () => {
        const ws = createMockWs();
        await routeMessage({ type: 'abort', payload: { reason: 'user cancelled' } }, configModule, eventLog, ws);
        const log = eventLog.getSince(0);
        const abortEvent = log.find((e) => e.event === 'squad:abort');
        expect(abortEvent).toBeDefined();
        expect(abortEvent.payload.reason).toBe('user cancelled');
    });
});
