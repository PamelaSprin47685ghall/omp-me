import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Bug: modelPool.acquire returns null for empty pools, but
 * modelPool.release(null) crashes (TypeError: Cannot read properties of null).
 * PRD §6.4 says empty pool → fallback to session model.
 * The acquire(null) is expected, but release must handle it gracefully.
 */
describe('ModelPool null-safety', () => {
    it('release(null) must be a no-op', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([{ provider: 'p1', modelId: 'm1', role: 'worker' }]);
        // Should not throw
        pool.release(null);
        pool.release(undefined);
        assert.ok(true, 'release(null) and release(undefined) must not throw');
    });

    it('ModelPool.release has null guard at source', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/model-pool.js', 'utf8');
        const releaseMethod = src.match(/release\(slot\)\s*\{[^}]+\}/);
        assert.ok(releaseMethod, 'release method must exist');
        assert.ok(src.includes('if (!slot) return;'), 'ModelPool.release must guard against null slot at the source');
    });

    it('all modelPool.release call sites are safe due to source guard', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([{ provider: 'p1', modelId: 'm1', role: 'worker' }]);
        // Release null - should not throw
        pool.release(null);
        pool.release(undefined);

        // Release valid slot - should work
        const slot = await pool.acquire('worker');
        assert.ok(slot, 'acquire must return slot');
        pool.release(slot);

        // Release already released slot - should not throw
        pool.release(slot);

        assert.ok(true, 'all release calls are safe');
    });
});
