import { strict as assert } from 'node:assert';
import { test } from 'bun:test';
import { ModelPool } from '../../server/model-pool.js';

test('constructor parses config into role-specific slots', () => {
    const config = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', role: 'worker', thinkingLevel: 'medium' },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022', role: 'reviewer' },
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', role: 'worker', thinkingLevel: 'high' },
    ];
    const pool = new ModelPool(config);
    assert.equal(pool.workerSlots.length, 2);
    assert.equal(pool.reviewerSlots.length, 1);
    assert.equal(pool.workerSlots[0].provider, 'anthropic');
    assert.equal(pool.workerSlots[0].thinkingLevel, 'medium');
    assert.equal(pool.reviewerSlots[0].modelId, 'claude-3-5-haiku-20241022');
});

test('acquire returns immediately when slot available', async () => {
    const config = [{ provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker' }];
    const pool = new ModelPool(config);
    const slot = await pool.acquire('worker');
    assert.equal(slot.provider, 'anthropic');
    assert.equal(slot.modelId, 'claude-sonnet');
    assert.equal(pool.workerSlots[0].inUse, true);
});

test('acquire waits when no slot available', async () => {
    const config = [{ provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker' }];
    const pool = new ModelPool(config);
    const slot1 = await pool.acquire('worker');
    let slot2Resolved = false;
    const slot2Promise = pool.acquire('worker').then((s) => {
        slot2Resolved = true;
        return s;
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(slot2Resolved, false);
    pool.release(slot1);
    const slot2 = await slot2Promise;
    assert.equal(slot2Resolved, true);
    assert.equal(slot2.provider, 'anthropic');
});

test('release marks slot available and wakes next waiter', async () => {
    const config = [{ provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker' }];
    const pool = new ModelPool(config);
    const slot1 = await pool.acquire('worker');
    const slot2Promise = pool.acquire('worker');
    pool.release(slot1);
    const slot2 = await slot2Promise;
    assert.equal(slot2.provider, 'anthropic');
    assert.equal(pool.workerSlots[0].inUse, true);
});

test('role isolation - worker queue never gets reviewer slots', async () => {
    const config = [{ provider: 'anthropic', modelId: 'reviewer-model', role: 'reviewer' }];
    const pool = new ModelPool(config);
    const slot = await pool.acquire('worker');
    assert.strictEqual(slot, null, 'empty worker pool returns null for fallback');
    assert.equal(pool.workerQueue.length, 0, 'no waiters queued when pool empty');
});

test('same config row multiple times = multiple slots', async () => {
    const config = [
        { provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker' },
        { provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker' },
        { provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker' },
    ];
    const pool = new ModelPool(config);
    await pool.acquire('worker');
    await pool.acquire('worker');
    await pool.acquire('worker');
    assert.equal(pool.workerSlots.length, 3);
    assert.equal(pool.workerSlots.filter((s) => s.inUse).length, 3);
});

test('empty pool returns null for any role', async () => {
    const pool = new ModelPool([]);
    const workerSlot = await pool.acquire('worker');
    assert.strictEqual(workerSlot, null, 'empty pool acquire returns null for worker');
    const reviewerSlot = await pool.acquire('reviewer');
    assert.strictEqual(reviewerSlot, null, 'empty pool acquire returns null for reviewer');
});

test('all pending_delete pool returns null', async () => {
    const pool = new ModelPool([
        { provider: 'anthropic', modelId: 'm1', role: 'worker' },
        { provider: 'anthropic', modelId: 'm2', role: 'reviewer' },
    ]);
    pool.workerSlots[0].pendingDelete = true;
    pool.reviewerSlots[0].pendingDelete = true;
    const workerSlot = await pool.acquire('worker');
    assert.strictEqual(workerSlot, null);
    const reviewerSlot = await pool.acquire('reviewer');
    assert.strictEqual(reviewerSlot, null);
});

test('acquire resolves exactly once', async () => {
    const config = [{ provider: 'anthropic', modelId: 'single', role: 'worker' }];
    const pool = new ModelPool(config);
    const slot1 = await pool.acquire('worker');
    let resolveCount = 0;
    const promise = pool.acquire('worker').then((s) => {
        resolveCount++;
        return s;
    });
    pool.release(slot1);
    await promise;
    assert.equal(resolveCount, 1);
});
