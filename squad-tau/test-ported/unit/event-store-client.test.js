/**
 * EventStore client class — structural sharing, idle barrier, listener lifecycle.
 *
 * Pure unit tests: no server, no DOM, no Vite.
 * Tests the EventStore wrapper around projections.applyEvent.
 *
 * The projection logic itself is covered in projections.test.js.
 * This file covers:
 *  - state.getState() / isIdle() / getCursor() initial contract
 *  - dispatch updates state and cursor tracking
 *  - structural sharing (identity stability across unchanged branches)
 *  - subscribe / unsubscribe listener lifecycle
 *  - reset() reversion and listener notification
 *  - _busyCount recovery when dispatch throws (finally block guarantee)
 *  - multiple listeners and idempotent unsubscribe
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { EventStore } from '../../client/event-store.js';

describe('EventStore client class', () => {
    it('initial state: isIdle() true, cursor 0, state tree present', () => {
        const store = new EventStore();
        assert.ok(store.isIdle(), 'isIdle must be true initially');
        assert.equal(store.getCursor(), 0, 'cursor starts at 0');
        const state = store.getState();
        assert.ok(state.nodes, 'state.nodes exists');
        assert.ok(state.runtime, 'state.runtime exists');
        assert.ok(state.config, 'state.config exists');
        assert.equal(state.config.maxWorkers, 3, 'default config.maxWorkers');
    });

    it('dispatch applies event to state', () => {
        const store = new EventStore();
        store.dispatch('config:capacity_changed', { maxWorkers: 5 });
        assert.equal(store.getState().config.maxWorkers, 5);
    });

    it('dispatch with seq advances cursor to seq + 1', () => {
        const store = new EventStore();
        store.dispatch('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 }, 42);
        assert.equal(store.getCursor(), 43, 'cursor = seq + 1');
    });

    it('dispatch with seq smaller than cursor does not reduce cursor', () => {
        const store = new EventStore();
        store.dispatch('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 }, 42);
        store.dispatch('session:start', { sessionId: 's2', nodeId: 'n2', epoch: 0 }, 10);
        assert.equal(store.getCursor(), 43, 'cursor never decreases');
    });

    it('dispatch without seq does not change cursor', () => {
        const store = new EventStore();
        store.dispatch('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 });
        assert.equal(store.getCursor(), 0, 'cursor unchanged without seq');
    });

    it('isIdle() is true after dispatch completes', () => {
        const store = new EventStore();
        store.dispatch('config:capacity_changed', { maxWorkers: 5 });
        assert.ok(store.isIdle(), 'isIdle after dispatch');
    });

    // ── Structural Sharing ──

    it('structural sharing: unchanged branches keep reference identity', () => {
        const store = new EventStore();
        store.dispatch('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 });
        store.dispatch('session:start', { sessionId: 's2', nodeId: 'n2', epoch: 0 });
        const msgRef = store.getState().messages; // messages is undefined initially, so Object.create(null)

        // config:capacity_changed touches config only — messages branch is unchanged
        store.dispatch('config:capacity_changed', { maxWorkers: 5 });
        assert.equal(store.getState().messages, msgRef, 'messages branch unchanged');
    });

    it('structural sharing: changed branches get new reference', () => {
        const store = new EventStore();
        store.dispatch('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 });
        const sessRef = store.getState().runtime.sessions;

        // Adding a second session changes the sessions sub-tree
        store.dispatch('session:start', { sessionId: 's2', nodeId: 'n2', epoch: 0 });
        assert.notEqual(store.getState().runtime.sessions, sessRef, 'sessions branch changed');
    });

    it('structural sharing: nested unchanged branches deep in tree keep identity', () => {
        const store = new EventStore();
        store.dispatch('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 });
        const squadRef = store.getState().squad;

        // session:start modifies runtime.sessions and stats — squad is unchanged
        store.dispatch('session:start', { sessionId: 's2', nodeId: 'n2', epoch: 0 });
        assert.equal(store.getState().squad, squadRef, 'squad branch untouched');
    });

    // ── Subscribe / Listener Lifecycle ──

    it('subscribe calls listener on every dispatch', () => {
        const store = new EventStore();
        let callCount = 0;
        store.subscribe(() => {
            callCount++;
        });
        store.dispatch('config:capacity_changed', { maxWorkers: 5 });
        assert.equal(callCount, 1, 'listener called once');
        store.dispatch('config:capacity_changed', { maxWorkers: 10 });
        assert.equal(callCount, 2, 'listener called twice');
    });

    it('subscribe returns a function that unsubscribes', () => {
        const store = new EventStore();
        let callCount = 0;
        const fn = () => {
            callCount++;
        };
        const unsub = store.subscribe(fn);
        assert.equal(typeof unsub, 'function', 'unsubscribe is a function');

        store.dispatch('config:capacity_changed', { maxWorkers: 1 });
        assert.equal(callCount, 1);

        unsub();
        store.dispatch('config:capacity_changed', { maxWorkers: 2 });
        assert.equal(callCount, 1, 'listener not called after unsubscribe');
    });

    it('unsubscribe is idempotent', () => {
        const store = new EventStore();
        let callCount = 0;
        const fn = () => {
            callCount++;
        };
        const unsub = store.subscribe(fn);
        unsub(); // first call
        unsub(); // second call — should not throw
        store.dispatch('config:capacity_changed', { maxWorkers: 1 });
        assert.equal(callCount, 0, 'listener never called after unsub');
    });

    it('multiple listeners all receive notifications', () => {
        const store = new EventStore();
        let a = 0,
            b = 0;
        store.subscribe(() => {
            a++;
        });
        store.subscribe(() => {
            b++;
        });
        store.dispatch('config:capacity_changed', { maxWorkers: 42 });
        assert.equal(a, 1, 'listener A called');
        assert.equal(b, 1, 'listener B called');
    });

    // ── Reset ──

    it('reset reverts state to initial, resets cursor, and notifies listeners', () => {
        const store = new EventStore();
        store.dispatch('config:capacity_changed', { maxWorkers: 10 });
        store.dispatch('session:start', { sessionId: 's1', nodeId: 'n1', epoch: 0 }, 100);
        assert.equal(store.getState().config.maxWorkers, 10);
        assert.equal(store.getCursor(), 101);

        let callCount = 0;
        store.subscribe(() => {
            callCount++;
        });

        store.reset();

        assert.equal(store.getState().config.maxWorkers, 3, 'config reverted');
        assert.equal(store.getState().squad.status, null, 'squad status cleared');
        assert.equal(store.getCursor(), 0, 'cursor reset');
        assert.equal(callCount, 1, 'listener notified on reset');
    });

    it('reset works on fresh store (no prior dispatches)', () => {
        const store = new EventStore();
        store.reset(); // must not throw
        assert.ok(store.isIdle());
        assert.equal(store.getCursor(), 0);
    });

    // ── _busyCount Recovery (finally block guarantee) ──

    it('_busyCount recovers to 0 when dispatch throws', () => {
        const store = new EventStore();
        assert.ok(store.isIdle(), 'initially idle');

        // dispatch with missing required fields must throw
        assert.throws(
            () => {
                store.dispatch('session:start', {});
            },
            /sessionId/,
            'session:start without sessionId throws',
        );

        // After the throw, _busyCount must be 0 because finally decrements
        assert.ok(store.isIdle(), 'isIdle after throwing dispatch');
        assert.equal(store.getCursor(), 0, 'cursor unchanged after throwing dispatch');
    });

    it('can dispatch normally after error recovery', () => {
        const store = new EventStore();

        // Cause a fault
        assert.throws(() => {
            store.dispatch('session:start', {});
        });

        // Subsequent dispatch must work normally
        store.dispatch('config:capacity_changed', { maxWorkers: 10 });
        assert.equal(store.getState().config.maxWorkers, 10);
        assert.ok(store.isIdle(), 'still idle after error+recovery');
    });

    it('_busyCount recovers even when both applyEvent AND listener throw', () => {
        const store = new EventStore();
        store.subscribe(() => {
            throw new Error('listener kaboom');
        });

        assert.throws(() => {
            store.dispatch('config:capacity_changed', { maxWorkers: 5 });
        }, /listener kaboom/);

        // _busyCount must still be 0 — finally ran before listener loop
        assert.ok(store.isIdle(), 'isIdle after listener throws');
    });

    // ── State Reference Stability ──

    it('getState() returns stable reference across dispatches that do not change it', () => {
        const store = new EventStore();
        const state1 = store.getState();
        const state2 = store.getState();
        assert.equal(state1, state2, 'getState() is stable between dispatches');
    });

    it('getState() reference changes after dispatch that modifies state', () => {
        const store = new EventStore();
        const state1 = store.getState();
        store.dispatch('config:capacity_changed', { maxWorkers: 5 });
        const state2 = store.getState();
        assert.notEqual(state1, state2, 'new root after dispatch');
    });
});
