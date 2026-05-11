import path from 'path';
import { OMP_ME_HOME } from '@oh-my-pi/resolve-pi';
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

/**
 * Bug: watchConfig replaces entire ModelPool instead of incremental update.
 * PRD §6.5: "对比内存中的 ModelPool 状态 → 更新 ModelPool 实例
 * （增/删/改槽位，不影响正在运行的任务）"
 */
describe('model-pool-config watchConfig incremental update', () => {
    it('watchConfig handler delegates to syncModelPoolFromConfig', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/server-lifecycle.js'), 'utf8');

        // Find the watchConfig callback section
        const watchIdx = src.indexOf('watchConfig(() =>');
        assert.ok(watchIdx >= 0, 'must have watchConfig callback');

        // Within the watchConfig callback, there should be NO 'new ModelPool('
        const callbackSrc = src.slice(watchIdx);
        const cbEnd = callbackSrc.indexOf('});');
        const cbBody = callbackSrc.slice(0, cbEnd + 3);

        assert.ok(
            !cbBody.includes('new ModelPool('),
            'watchConfig must NOT create new ModelPool (loses in-use tracking)',
        );

        // Must use syncModelPoolFromConfig which does incremental update
        assert.ok(cbBody.includes('syncModelPoolFromConfig'), 'watchConfig must delegate to syncModelPoolFromConfig');
    });

    it('syncModelPoolFromConfig uses addSlot and removeSlot', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/model-pool-config.js'), 'utf8');
        assert.ok(src.includes('addSlot'), 'syncModelPoolFromConfig must call addSlot');
        assert.ok(src.includes('removeSlot'), 'syncModelPoolFromConfig must call removeSlot');
    });

    it('ModelPool.addSlot preserves existing in-use slots', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([{ provider: 'p1', modelId: 'm1', role: 'worker' }]);

        // Acquire to mark as in-use
        const slot = await pool.acquire('worker');
        assert.ok(slot._slot.inUse, 'slot should be in-use');

        // Add new slot - should not affect the in-use slot
        pool.addSlot({ provider: 'p2', modelId: 'm2', role: 'worker' });

        const stats = pool.getStats();
        assert.strictEqual(stats.workerTotal, 2, 'should have 2 worker slots');
        assert.strictEqual(stats.workerAvail, 1, '1 should be available (1 in-use)');

        // Release original slot
        pool.release(slot);
        assert.strictEqual(pool.getStats().workerAvail, 2);
    });

    it('ModelPool.removeSlot marks in-use slots as pending_delete', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([
            { provider: 'p1', modelId: 'm1', role: 'worker' },
            { provider: 'p2', modelId: 'm2', role: 'reviewer' },
        ]);

        const slot = await pool.acquire('worker');
        // Remove index 0 (the worker slot, which is in-use)
        pool.removeSlot(0);

        // Slot should still be in the pool (pending_delete)
        assert.strictEqual(pool.workerSlots.length, 1);
        assert.ok(pool.workerSlots[0].pendingDelete, 'should be pending delete');
        assert.ok(pool.workerSlots[0].inUse, 'still in-use');

        // Release triggers actual removal
        pool.release(slot);
        assert.strictEqual(pool.workerSlots.length, 0, 'released pending_delete slot is removed');
    });
});

/**
 * Bug: Missing scroll-to-bottom floating button.
 * PRD §4.6: "用户向上滚动后，底部显示浮动按钮（使用 Blueprint Icon，
 * 语义为"回到最新消息"，点击恢复自动跟随）"
 */
describe('Auto-scroll floating button', () => {
    it('useAutoScroll hook returns scrollToBottom function', async () => {
        const src = await import('fs').then((fs) =>
            fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'client/hooks/useAutoScroll.js'), 'utf8'),
        );
        assert.ok(src.includes('scrollToBottom'), 'hook must expose scrollToBottom');
        assert.ok(src.includes('isAtBottom'), 'hook must expose isAtBottom state');
    });

    it('MessageList must pass scrollToBottom to floating button', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'client/components/MessageList.jsx'), 'utf8');

        // The component should render a scroll-to-bottom button
        // when not at bottom. Check for scroll-bottom-btn class usage.
        const hasScrollBtn =
            src.includes('scroll-bottom-btn') || src.includes('scrollToBottom') || src.includes('isAtBottom');
        assert.ok(hasScrollBtn, 'MessageList must render scroll-to-bottom button');
    });
});

/**
 * Bug: dag-concurrency.js hardcodes 5 instead of using DEFAULTS.FALLBACK_CONCURRENCY
 */
describe('FALLBACK_CONCURRENCY constant usage', () => {
    it('dag-concurrency must import FALLBACK_CONCURRENCY from constants', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/dag-concurrency.js'), 'utf8');
        // Should import the constant, not hardcode 5
        assert.ok(
            src.includes('FALLBACK_CONCURRENCY') || src.includes('DEFAULTS'),
            'dag-concurrency must import FALLBACK_CONCURRENCY from constants',
        );
    });

    it('constants.js defines FALLBACK_CONCURRENCY as 5', async () => {
        const { DEFAULTS } = await import('../../server/constants.js');
        assert.strictEqual(DEFAULTS.FALLBACK_CONCURRENCY, 5);
    });
});

/**
 * Bug: REVIEWER_MAX_EMPTY should be in constants.
 */
describe('REVIEWER_MAX_EMPTY location', () => {
    it('REVIEWER_MAX_EMPTY should be defined in empty-turns.js', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/empty-turns.js'), 'utf8');
        // empty-turns.js currently only exports MAX_EMPTY_TURNS and CONFIRM_MAX_EMPTY
        // Should also export REVIEWER_MAX_EMPTY and OUTER_REVIEW_MAX_EMPTY
        assert.ok(
            src.includes('REVIEWER_MAX_EMPTY') && src.includes('OUTER_REVIEW_MAX_EMPTY'),
            'empty-turns.js must export REVIEWER_MAX_EMPTY and OUTER_REVIEW_MAX_EMPTY',
        );
    });

    it('run-reviewer.js must import REVIEWER_MAX_EMPTY from empty-turns.js', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/run-reviewer.js'), 'utf8');
        assert.ok(
            src.includes('empty-turns.js') && src.includes('REVIEWER_MAX_EMPTY'),
            'run-reviewer.js must import REVIEWER_MAX_EMPTY from empty-turns',
        );
    });

    it('outer-review.js must import OUTER_REVIEW_MAX_EMPTY from empty-turns.js', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(path.join(OMP_ME_HOME, 'squad-tau', 'server/outer-review.js'), 'utf8');
        assert.ok(
            src.includes('empty-turns.js') && src.includes('OUTER_REVIEW_MAX_EMPTY'),
            'outer-review.js must import OUTER_REVIEW_MAX_EMPTY from empty-turns',
        );
    });
});
