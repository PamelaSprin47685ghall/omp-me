import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Bug: model_pool:changed not emitted after browser add/remove/edit.
 * PRD §6.3: 服务端收到 model_pool:update 后必须广播 model_pool:changed 到所有连接
 */
describe('model_pool:changed broadcast after update (PRD §6.3)', () => {
    it('handleModelPoolMessage must emit model_pool:changed after add', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/model-pool-events.js', 'utf8');
        // The function must receive eventBus and emit after each action
        assert.ok(src.includes('eventBus'), 'handleModelPoolMessage must accept eventBus param');
        assert.ok(
            src.includes('model_pool') && (src.includes('changed') || src.includes('changed')),
            'handleModelPoolMessage must emit model_pool:changed',
        );
    });

    it('ws-handler routes model_pool:update to handleModelPoolMessage with eventBus', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/ws-handler.js', 'utf8');
        const caseIdx = src.indexOf("case 'model_pool:update'");
        assert.ok(caseIdx >= 0, 'must handle model_pool:update');
        // The call must pass eventBus
        const afterCase = src.slice(caseIdx, caseIdx + 200);
        assert.ok(afterCase.includes('eventBus'), 'routeMessage must pass eventBus to handleModelPoolMessage');
    });
});

/**
 * Bug: session:state event never emitted.
 * PRD §5.5 defines session:state event for session phase changes.
 */
describe('session:state event emission (PRD §5.5)', () => {
    it('run-worker.js must emit session:state for authoring/completed/aborted', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-worker.js', 'utf8');
        // Must emit session, state at appropriate points
        const matches = src.match(/eventBus\.emit\('session',\s*'state'/g);
        assert.ok(matches && matches.length > 0, 'run-worker must emit session:state events');
        assert.ok(matches.length >= 2, 'run-worker must emit session:state at least twice (start+end)');
    });

    it('run-reviewer.js must emit session:state for reviewing/completed', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/run-reviewer.js', 'utf8');
        const matches = src.match(/eventBus\.emit\('session',\s*'state'/g);
        assert.ok(matches && matches.length >= 1, 'run-reviewer must emit session:state');
    });

    it('outer-review.js must emit session:state', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/outer-review.js', 'utf8');
        const matches = src.match(/eventBus\.emit\('session',\s*'state'/g);
        assert.ok(matches && matches.length >= 1, 'outer-review must emit session:state');
    });
});

/**
 * Bug: ModelPool.acquire hangs forever when pool is empty.
 * PRD §6.4: 池空时回落到当前会话模型 (acquire returns null/falsy)
 */
describe('ModelPool empty-pool fallback (PRD §6.4)', () => {
    it('acquire returns null when pool has no slots', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([]); // empty config

        const slot = await pool.acquire('worker');
        assert.strictEqual(slot, null, 'acquire must return null when pool is empty (trigger fallback)');
    });

    it('acquire returns null when all slots are pending_delete', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([{ provider: 'p1', modelId: 'm1', role: 'worker' }]);

        // Mark all slots as pending_delete
        pool.workerSlots[0].pendingDelete = true;

        const slot = await pool.acquire('worker');
        assert.strictEqual(slot, null, 'acquire must return null when only pending_delete slots exist');
    });

    it('acquire returns slot when slots are available', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([{ provider: 'p1', modelId: 'm1', role: 'worker' }]);

        const slot = await pool.acquire('worker');
        assert.ok(slot, 'acquire must return slot when available');
        assert.strictEqual(slot.provider, 'p1');
        assert.strictEqual(slot.modelId, 'm1');
    });
});
