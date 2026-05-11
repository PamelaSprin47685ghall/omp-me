import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../server/event-bus.js';
describe('EventBus - basic subscribe/publish', () => {
    it('emits and receives exact event', () => {
        const bus = new EventBus();
        const received = [];
        bus.on('squad:init', (payload) => received.push(payload));
        bus.emit('squad', 'init', { id: 'test-1' });
        assert.deepStrictEqual(received, [{ id: 'test-1' }]);
    });
    it('multiple handlers receive same event', () => {
        const bus = new EventBus();
        const r1 = [],
            r2 = [];
        bus.on('squad:start', (payload) => r1.push(payload));
        bus.on('squad:start', (payload) => r2.push(payload));
        bus.emit('squad', 'start', { node: 'A' });
        assert.deepStrictEqual(r1, [{ node: 'A' }]);
        assert.deepStrictEqual(r2, [{ node: 'A' }]);
    });
    it('different events do not cross-trigger', () => {
        const bus = new EventBus();
        const received = [];
        bus.on('squad:init', (payload) => received.push(payload));
        bus.emit('squad', 'start', { node: 'B' });
        assert.deepStrictEqual(received, []);
    });
});
describe('EventBus - wildcard subscription', () => {
    it('squad:* receives all squad: events', () => {
        const bus = new EventBus();
        const received = [];
        bus.on('squad:*', (payload, fullEvent) => received.push({ event: fullEvent, payload }));
        bus.emit('squad', 'init', { id: '1' });
        bus.emit('squad', 'start', { id: '2' });
        bus.emit('squad', 'complete', { id: '3' });
        assert.deepStrictEqual(received, [
            { event: 'squad:init', payload: { id: '1' } },
            { event: 'squad:start', payload: { id: '2' } },
            { event: 'squad:complete', payload: { id: '3' } },
        ]);
    });
    it('wildcard receives events that also match exact listeners', () => {
        const bus = new EventBus();
        const wildcardReceived = [],
            exactReceived = [];
        bus.on('squad:*', (payload, fullEvent) => wildcardReceived.push(fullEvent));
        bus.on('squad:init', (payload) => exactReceived.push(payload));
        bus.emit('squad', 'init', { id: 'test' });
        assert.deepStrictEqual(wildcardReceived, ['squad:init']);
        assert.deepStrictEqual(exactReceived, [{ id: 'test' }]);
    });
    it('global * receives all events across namespaces', () => {
        const bus = new EventBus();
        const received = [];
        bus.on('*', (payload, fullEvent) => received.push(fullEvent));
        bus.emit('squad', 'init', {});
        bus.emit('session', 'message', {});
        bus.emit('model_pool', 'update', {});
        assert.deepStrictEqual(received, ['squad:init', 'session:message', 'model_pool:update']);
    });
});
describe('EventBus - namespace isolation', () => {
    it('squad:* does not receive session: events', () => {
        const bus = new EventBus();
        const squadReceived = [],
            sessionReceived = [];
        bus.on('squad:*', (payload, fullEvent) => squadReceived.push(fullEvent));
        bus.on('session:*', (payload, fullEvent) => sessionReceived.push(fullEvent));
        bus.emit('squad', 'init', {});
        bus.emit('session', 'message', {});
        assert.deepStrictEqual(squadReceived, ['squad:init']);
        assert.deepStrictEqual(sessionReceived, ['session:message']);
    });
    it('exact listeners are namespace-isolated', () => {
        const bus = new EventBus();
        const received = [];
        bus.on('squad:start', () => received.push('squad'));
        bus.on('session:start', () => received.push('session'));
        bus.emit('squad', 'start', {});
        assert.deepStrictEqual(received, ['squad']);
    });
});
describe('EventBus - unsubscribe', () => {
    it('unsubscribe removes exact handler', () => {
        const bus = new EventBus();
        const received = [];
        const unsubscribe = bus.on('squad:init', (payload) => received.push(payload));
        bus.emit('squad', 'init', { id: '1' });
        unsubscribe();
        bus.emit('squad', 'init', { id: '2' });
        assert.deepStrictEqual(received, [{ id: '1' }]);
    });
    it('unsubscribe removes wildcard handler', () => {
        const bus = new EventBus();
        const received = [];
        const unsubscribe = bus.on('squad:*', (payload, fullEvent) => received.push(fullEvent));
        bus.emit('squad', 'init', {});
        unsubscribe();
        bus.emit('squad', 'start', {});
        assert.deepStrictEqual(received, ['squad:init']);
    });
    it('unsubscribe does not affect other handlers', () => {
        const bus = new EventBus();
        const r1 = [],
            r2 = [];
        const unsub1 = bus.on('squad:init', () => r1.push('h1'));
        bus.on('squad:init', () => r2.push('h2'));
        unsub1();
        bus.emit('squad', 'init', {});
        assert.deepStrictEqual(r1, []);
        assert.deepStrictEqual(r2, ['h2']);
    });
    it('multiple unsubscribe calls are safe', () => {
        const bus = new EventBus();
        const received = [];
        const unsubscribe = bus.on('squad:init', () => received.push('x'));
        unsubscribe();
        unsubscribe();
        bus.emit('squad', 'init', {});
        assert.deepStrictEqual(received, []);
    });
});
