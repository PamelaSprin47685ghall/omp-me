import { strict as assert } from 'node:assert';
import { test } from 'bun:test';
import { ModelPool } from '../../server/model-pool.js';

test('signal.abort rejects pending acquire', async () => {
    const config = [{ provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker' }];
    const pool = new ModelPool(config);
    await pool.acquire('worker');
    const controller = new AbortController();
    const acquirePromise = pool.acquire('worker', controller.signal);
    controller.abort();
    await assert.rejects(acquirePromise, (err) => err.message === 'Acquire aborted');
    assert.equal(pool.workerQueue.length, 0);
});

test('addSlot immediately wakes waiting acquire', async () => {
    // Use a non-empty pool to avoid triggering empty-pool fallback
    const config = [{ provider: 'anthropic', modelId: 'exiting-slot', role: 'worker' }];
    const pool = new ModelPool(config);
    // Use up the existing slot so next acquire waits
    const existingSlot = await pool.acquire('worker');
    let resolved = false;
    const acquirePromise = pool.acquire('worker').then((slot) => {
        resolved = true;
        return slot;
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(resolved, false);
    pool.addSlot({ provider: 'anthropic', modelId: 'new-model', role: 'worker', thinkingLevel: 'low' });
    const slot = await acquirePromise;
    assert.equal(resolved, true);
    assert.equal(slot.modelId, 'new-model');
    // Cleanup the first slot
    pool.release(existingSlot);
});

test('removeSlot marks inUse slot as pendingDelete', () => {
    const config = [
        { provider: 'anthropic', modelId: 'worker-1', role: 'worker' },
        { provider: 'anthropic', modelId: 'reviewer-1', role: 'reviewer' },
    ];
    const pool = new ModelPool(config);
    pool.workerSlots[0].inUse = true;
    pool.removeSlot(0);
    assert.equal(pool.workerSlots[0].pendingDelete, true);
    assert.equal(pool.workerSlots.length, 1);
});

test('removeSlot removes free slot immediately', () => {
    const config = [
        { provider: 'anthropic', modelId: 'worker-1', role: 'worker' },
        { provider: 'anthropic', modelId: 'reviewer-1', role: 'reviewer' },
    ];
    const pool = new ModelPool(config);
    pool.removeSlot(0);
    assert.equal(pool.workerSlots.length, 0);
    assert.equal(pool.reviewerSlots.length, 1);
});

test('release removes pendingDelete slot', async () => {
    const config = [{ provider: 'anthropic', modelId: 'worker-1', role: 'worker' }];
    const pool = new ModelPool(config);
    const slot = await pool.acquire('worker');
    pool.removeSlot(0);
    assert.equal(pool.workerSlots.length, 1);
    assert.equal(pool.workerSlots[0].pendingDelete, true);
    pool.release(slot);
    assert.equal(pool.workerSlots.length, 0);
});

test('getSlots returns full slot array', () => {
    const config = [
        { provider: 'anthropic', modelId: 'worker-1', role: 'worker' },
        { provider: 'anthropic', modelId: 'reviewer-1', role: 'reviewer' },
    ];
    const pool = new ModelPool(config);
    const slots = pool.getSlots();
    assert.equal(slots.length, 2);
    assert.equal(slots[0].role, 'worker');
    assert.equal(slots[1].role, 'reviewer');
});

test('getStats returns correct availability counts', async () => {
    const config = [
        { provider: 'anthropic', modelId: 'worker-1', role: 'worker' },
        { provider: 'anthropic', modelId: 'worker-2', role: 'worker' },
        { provider: 'anthropic', modelId: 'reviewer-1', role: 'reviewer' },
    ];
    const pool = new ModelPool(config);
    let stats = pool.getStats();
    assert.equal(stats.workerAvail, 2);
    assert.equal(stats.workerTotal, 2);
    assert.equal(stats.reviewerAvail, 1);
    assert.equal(stats.reviewerTotal, 1);
    await pool.acquire('worker');
    stats = pool.getStats();
    assert.equal(stats.workerAvail, 1);
    assert.equal(stats.workerTotal, 2);
});

test('release allocates the SAME slot that was released', async () => {
    const config = [
        { provider: 'anthropic', modelId: 'slot-A', role: 'worker' },
        { provider: 'anthropic', modelId: 'slot-B', role: 'worker' },
    ];
    const pool = new ModelPool(config);
    const slotA = await pool.acquire('worker');
    assert.equal(slotA.modelId, 'slot-A');
    const slotB = await pool.acquire('worker');
    assert.equal(slotB.modelId, 'slot-B');
    const waiterPromise = pool.acquire('worker');
    pool.release(slotA);
    const waiterSlot = await waiterPromise;
    assert.equal(waiterSlot.modelId, 'slot-A');
    assert.equal(pool.workerSlots[0].inUse, true);
    assert.equal(pool.workerSlots[1].inUse, true);
});

test('release does not cause double-allocation', async () => {
    const config = [
        { provider: 'anthropic', modelId: 'slot-A', role: 'worker' },
        { provider: 'anthropic', modelId: 'slot-B', role: 'worker' },
    ];
    const pool = new ModelPool(config);
    const slotA = await pool.acquire('worker');
    const slotB = await pool.acquire('worker');
    const waiterPromise = pool.acquire('worker');
    pool.release(slotA);
    const waiterSlot = await waiterPromise;
    assert.equal(waiterSlot.modelId, 'slot-A');
    const slotBState = pool.workerSlots.find((s) => s.modelId === 'slot-B');
    assert.equal(slotBState.inUse, true);
    const slotAState = pool.workerSlots.find((s) => s.modelId === 'slot-A');
    assert.equal(slotAState.inUse, true);
});

test('pendingDelete slot skipped by acquire but counted in total', async () => {
    const config = [
        { provider: 'anthropic', modelId: 'slot-A', role: 'worker' },
        { provider: 'anthropic', modelId: 'slot-B', role: 'worker' },
    ];
    const pool = new ModelPool(config);
    pool.workerSlots[0].inUse = true;
    pool.workerSlots[0].pendingDelete = true;
    const slot = await pool.acquire('worker');
    assert.equal(slot.modelId, 'slot-B');
});
