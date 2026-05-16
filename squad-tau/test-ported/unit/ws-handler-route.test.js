import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'bun:test';
import { EventLog } from '../../server/event-log.js';
import { routeMessage } from '../../server/ws-handler.js';

function createMockWs() {
    const sent = [];
    return { sent, readyState: 1, send: (data) => sent.push(data) };
}

describe('routeMessage — server-side WS routing', () => {
    let eventLog;
    beforeEach(() => {
        eventLog = new EventLog();
    });

    it('unknown type returns false', async () => {
        const ws = createMockWs();
        const result = await routeMessage({ type: 'unknown:type', payload: {} }, eventLog, ws);
        assert.equal(result, false);
    });

    it('ping sends pong response', async () => {
        const ws = createMockWs();
        const result = await routeMessage({ type: 'ping' }, eventLog, ws);
        assert.equal(result, true);
        assert.equal(ws.sent.length, 1);
        const pong = JSON.parse(ws.sent[0]);
        assert.equal(pong.event, 'pong');
    });

    it('sync calls getSince and replays events', async () => {
        const ws = createMockWs();
        let cursorPassed = null;
        eventLog.getSince = (c) => {
            cursorPassed = c;
            return [{ event: 'test:event', payload: { ok: true }, id: 42, tick: 123 }];
        };
        const result = await routeMessage({ type: 'sync', payload: { cursor: 10 } }, eventLog, ws);
        assert.equal(result, true);
        assert.equal(cursorPassed, 10);
        assert.equal(ws.sent.length, 1);
        const msg = JSON.parse(ws.sent[0]);
        assert.equal(msg.event, 'test:event');
        assert.equal(msg.seq, 42);
    });

    it('session:user_message appends to EventLog', async () => {
        const ws = createMockWs();
        const result = await routeMessage(
            { type: 'session:user_message', payload: { sessionId: 's1', text: 'hello', messageId: 'm1' } },
            eventLog,
            ws,
        );
        assert.equal(result, true);
        const log = eventLog.getLog();
        const msgEvent = log.find((e) => e.event === 'session:message');
        assert.ok(msgEvent);
        assert.equal(msgEvent.payload.sessionId, 's1');
    });

    it('abort appends squad:abort to eventLog', async () => {
        const ws = createMockWs();
        await routeMessage({ type: 'abort', payload: { reason: 'user cancelled' } }, eventLog, ws);
        const log = eventLog.getLog();
        const abortEvent = log.find((e) => e.event === 'squad:abort');
        assert.ok(abortEvent);
        assert.equal(abortEvent.payload.reason, 'user cancelled');
    });
});
