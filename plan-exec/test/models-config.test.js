import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createModelPool, generateInitialConfig } from '../src/models-config.js';

describe('models-config', () => {
    it('generateInitialConfig creates one entry per available model', () => {
        const registry = {
            getAvailable: () => [
                { provider: 'openai', id: 'gpt-4', name: 'GPT-4' },
                { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
            ],
        };
        const config = generateInitialConfig(registry);
        assert.equal(config.length, 2);
        assert.deepEqual(config[0], { provider: 'openai', id: 'gpt-4', thinkingLevel: undefined });
        assert.deepEqual(config[1], { provider: 'anthropic', id: 'claude-sonnet-4', thinkingLevel: undefined });
    });

    it('generateInitialConfig handles missing registry', () => {
        const config = generateInitialConfig(undefined);
        assert.equal(config.length, 0);
    });

    it('createModelPool returns null for empty config', () => {
        assert.equal(createModelPool([]), null);
        assert.equal(createModelPool(null), null);
        assert.equal(createModelPool(undefined), null);
    });

    it('model pool limits concurrency and queues extras', async () => {
        const pool = createModelPool([
            { provider: 'a', id: 'm1', thinkingLevel: 'low' },
            { provider: 'b', id: 'm2' },
        ]);
        assert.ok(pool);
        assert.equal(pool.totalSlots, 2);

        const s1 = await pool.acquire();
        assert.ok(['m1', 'm2'].includes(s1.id));
        assert.equal(pool.busyCount, 1);

        const s2 = await pool.acquire();
        assert.ok(['m1', 'm2'].includes(s2.id));
        assert.notEqual(s1.id, s2.id);
        assert.equal(pool.busyCount, 2);

        // Third acquire should queue
        let s3Resolved = false;
        const s3Promise = pool.acquire().then((s) => {
            s3Resolved = true;
            return s;
        });

        // Give the queue a chance to settle
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(s3Resolved, false);

        // Release one slot — s3 should resolve
        s1.release();
        const s3 = await s3Promise;
        assert.equal(s3Resolved, true);
        assert.equal(pool.busyCount, 2);

        s2.release();
        s3.release();
        assert.equal(pool.busyCount, 0);
    });

    it('model pool cancelAll rejects queued waiters', async () => {
        const pool = createModelPool([{ provider: 'a', id: 'm1' }]);
        assert.ok(pool);

        const s1 = await pool.acquire();
        const s2Promise = pool.acquire();

        pool.cancelAll('aborted');

        await assert.rejects(s2Promise, /aborted/);
        s1.release();
    });

    it('model pool acquire respects abort signal', async () => {
        const pool = createModelPool([{ provider: 'a', id: 'm1' }]);
        assert.ok(pool);

        const ctrl = new AbortController();
        const s1 = await pool.acquire(ctrl.signal);

        const s2Promise = pool.acquire(ctrl.signal);
        ctrl.abort();

        await assert.rejects(s2Promise, /Parent session aborted/);
        s1.release();
    });
});
