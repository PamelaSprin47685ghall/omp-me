import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../server/event-bus.js';

/**
 * Bug 2 regression: Wildcard handler parameter order.
 * EventBus delivers (payload, fullEvent) to wildcard handlers.
 * ws-events.js receives them as (payload, type) — swapped from before.
 */
describe('EventBus wildcard parameter order (Bug 2 fixed)', () => {
    it('ws-events receives (payload, fullEvent) order after fix', () => {
        const bus = new EventBus();
        const received = [];

        bus.on('*', (payload, type) => {
            received.push({ payload, type });
        });

        bus.emit('session', 'message_delta', { text: 'hello' });

        assert.strictEqual(received.length, 1);
        assert.deepStrictEqual(received[0].payload, { text: 'hello' });
        assert.strictEqual(received[0].type, 'session:message_delta');
    });
});

/**
 * Bug 3 regression: All emit calls must use 3-arg format (namespace, event, payload).
 */
describe('EventBus 3-arg emit format enforced (Bug 3 fixed)', () => {
    it('correct 3-arg emit("squad", "node_state", data) matches squad:node_state listener', () => {
        const bus = new EventBus();
        const received = [];

        bus.on('squad:node_state', (payload) => {
            received.push(payload);
        });

        bus.emit('squad', 'node_state', { id: 'test' });

        assert.strictEqual(received.length, 1);
        assert.deepStrictEqual(received[0], { id: 'test' });
    });

    it('3-arg emit("squad", "abort", data) matches squad:* wildcard', () => {
        const bus = new EventBus();
        const received = [];

        bus.on('squad:*', (payload, fullEvent) => {
            received.push(fullEvent);
        });

        bus.emit('squad', 'abort', { reason: 'test' });

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0], 'squad:abort');
    });

    it('3-arg emit("model_pool", "changed", data) matches model_pool:*', () => {
        const bus = new EventBus();
        const received = [];

        bus.on('model_pool:*', (payload, fullEvent) => {
            received.push(fullEvent);
        });

        bus.emit('model_pool', 'changed', { slots: [] });

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0], 'model_pool:changed');
    });
});

/**
 * Bug 1 regression: ws-server + squad-engine integration.
 */
describe('ws-server.js creates wss with clients Set (Bug 1 fixed)', () => {
    it('createWsServer returns wss with clients set', async () => {
        const { createWsServer } = await import('../../server/ws-server.js');
        const { createServer } = await import('http');
        const httpServer = createServer();

        const result = createWsServer(httpServer);

        assert.ok(result.wss, 'must return wss');
        assert.ok(result.wss.clients instanceof Set, 'wss.clients must be a Set');

        httpServer.close();
        result.wss.close();
    });

    it('squad-engine.js no longer destructures clients from createWsServer', async () => {
        const source = await import('../../server/squad-engine.js');
        const src = source.default.toString();
        // After fix, squad-engine uses wsResult.wss.clients, not destructured clients
        assert.ok(!src.includes('const { clients }'), 'must NOT destructure clients (it was never returned)');
    });
});
