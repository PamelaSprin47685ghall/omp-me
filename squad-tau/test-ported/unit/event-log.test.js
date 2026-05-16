import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../server/event-log.js';

describe('EventLog — Fact Monotonicity', () => {
    it('append increases tick by 1', () => {
        const log = new EventLog();
        const e0 = log.append('session:start', { sessionId: 's1' });
        assert.equal(e0.tick, 0);
        assert.equal(e0.id, 0);
        assert.equal(log.length, 1);

        const e1 = log.append('session:end', { sessionId: 's1' });
        assert.equal(e1.tick, 1);
        assert.equal(e1.id, 1);
        assert.equal(log.length, 2);
    });

    it('batch entries share same tick, sequential ids', () => {
        const log = new EventLog();
        log.appendBatch([
            { event: 'session:start', payload: { sessionId: 's1' } },
            { event: 'session:start', payload: { sessionId: 's2' } },
            { event: 'squad:init', payload: { nodes: [] } },
        ]);
        assert.equal(log.length, 3);

        const entries = log.getLog();
        for (const e of entries) {
            assert.equal(e.tick, 0); // all share tick 0
        }
        assert.equal(entries[0].id, 0);
        assert.equal(entries[1].id, 1);
        assert.equal(entries[2].id, 2);
    });

    it('append after batch gets next tick', () => {
        const log = new EventLog();
        log.appendBatch([
            { event: 'session:start', payload: { sessionId: 's1' } },
            { event: 'session:start', payload: { sessionId: 's2' } },
        ]);
        const e = log.append('session:end', { sessionId: 's1' });
        assert.equal(e.tick, 1); // batch consumed tick 0
        assert.equal(e.id, 2);
    });

    it('deterministic replay: same input produces identical log', () => {
        const log1 = new EventLog();
        log1.append('session:start', { sessionId: 'a' });
        log1.append('session:start', { sessionId: 'b' });
        log1.append('session:end', { sessionId: 'a' });

        const log2 = new EventLog();
        log2.append('session:start', { sessionId: 'a' });
        log2.append('session:start', { sessionId: 'b' });
        log2.append('session:end', { sessionId: 'a' });

        assert.deepEqual(log1.getLog(), log2.getLog());
    });

    it('content-hydrated log produces same state as original', () => {
        const original = new EventLog();
        original.append('session:start', { sessionId: 'a' });
        original.append('session:start', { sessionId: 'b' });
        const snapshot = JSON.parse(JSON.stringify(original.getLog()));

        const rehydrated = new EventLog(snapshot);
        assert.equal(rehydrated.length, 2);
        assert.equal(rehydrated.currentTick, 2);
        assert.deepEqual(rehydrated.getLog(), snapshot);
    });

    it('subscribe receives single entry on append', () => {
        const log = new EventLog();
        const received = [];
        log.subscribe((e) => received.push(Array.isArray(e) ? e : [e]));
        log.append('session:start', { sessionId: 'x' });
        assert.equal(received.length, 1);
        assert.equal(received[0].length, 1);
        assert.equal(received[0][0].event, 'session:start');
    });

    it('subscribe receives batch array on appendBatch', () => {
        const log = new EventLog();
        const received = [];
        log.subscribe((e) => received.push(Array.isArray(e) ? e : [e]));
        log.appendBatch([
            { event: 'a', payload: {} },
            { event: 'b', payload: {} },
        ]);
        assert.equal(received.length, 1);
        assert.equal(received[0].length, 2);
        assert.equal(received[0][0].event, 'a');
        assert.equal(received[0][1].event, 'b');
    });

    it('unsubscribe stops notifications', () => {
        const log = new EventLog();
        let count = 0;
        const unsub = log.subscribe(() => count++);
        log.append('a', {});
        assert.equal(count, 1);
        unsub();
        log.append('b', {});
        assert.equal(count, 1); // no increment
    });

    it('reset clears everything', () => {
        const log = new EventLog();
        log.append('a', {});
        log.append('b', {});
        log.reset();
        assert.equal(log.length, 0);
        assert.equal(log.currentTick, 0);
    });
});
