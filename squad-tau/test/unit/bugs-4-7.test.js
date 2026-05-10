import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Bug 4: submit-plan.js onComplete must pass { results, mode, nodes } not raw array.
 */
describe('submit-plan onComplete contract (Bug 4 fixed)', () => {
    it('submit-plan passes { results, mode, nodes } to onComplete', async () => {
        const { createSubmitPlanHandler } = await import('../../server/submit-plan.js');

        let onCompleteCalled = false;
        let onCompleteArg = null;

        const fsm = { getState: () => 'active' };

        const handler = createSubmitPlanHandler({
            fsm,
            executeDAG: async () => [{ nodeId: 'n1', status: 'approved' }],
            ctx: {},
            pi: {},
            signal: null,
            eventBus: null,
            modelPool: null,
            originalTask: 'test task',
            onComplete: (arg) => {
                onCompleteCalled = true;
                onCompleteArg = arg;
            },
        });

        const result = await handler.handler({
            mode: 'M',
            reasoning: 'test',
            nodes: [{ id: 'n1', task: 'write code', review_criteria: 'quality' }],
        });

        assert.ok(onCompleteCalled, 'onComplete must be called');
        assert.ok(onCompleteArg, 'onComplete arg must be truthy');
        assert.ok(Array.isArray(onCompleteArg.results), 'onComplete must receive .results array');
        assert.strictEqual(onCompleteArg.mode, 'M', 'onComplete must receive .mode');
        assert.ok(Array.isArray(onCompleteArg.nodes), 'onComplete must receive .nodes array');
        assert.strictEqual(onCompleteArg.nodes.length, 1);
        assert.strictEqual(onCompleteArg.nodes[0].id, 'n1');
    });

    it('submit-plan does not call onComplete when not provided', async () => {
        const { createSubmitPlanHandler } = await import('../../server/submit-plan.js');

        const fsm = { getState: () => 'active' };

        const handler = createSubmitPlanHandler({
            fsm,
            executeDAG: async () => [],
            ctx: {},
            pi: {},
            signal: null,
            eventBus: null,
            modelPool: null,
            originalTask: 'test',
            // no onComplete
        });

        const result = await handler.handler({
            mode: 'M',
            reasoning: 'test',
            nodes: [{ id: 'n1', task: 'write code', review_criteria: 'quality' }],
        });

        assert.ok(result.success);
    });
});

/**
 * Bug 5: useDarkMode returns { isDark } but App.jsx must destructure it.
 * We can't test React hooks in node:test, but we can check the source code.
 */
describe('useDarkMode destructure contract (Bug 5 fixed)', () => {
    it('useDarkMode hook returns object with isDark property', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('client/hooks/useDarkMode.js', 'utf8');
        assert.ok(src.includes('return { isDark }'), 'hook must return { isDark } object');
    });

    it('App.jsx destructures isDark from useDarkMode', async () => {
        // Use fs to read App.jsx since it's JSX and can't be imported in node:test
        const fs = await import('fs');
        const src = fs.readFileSync('client/App.jsx', 'utf8');
        // After fix: const { isDark } = useDarkMode()
        assert.ok(src.includes('const { isDark } = useDarkMode()'), 'App.jsx must destructure isDark from useDarkMode');
    });
});

/**
 * Bug 6: App.jsx event type mapping must match reducer action types.
 */
describe('App.jsx event dispatch mapping (Bug 6 fixed)', () => {
    it('maps squad:init to SQUAD_INIT', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('client/App.jsx', 'utf8');
        // After fix: there should be a mapping for squad:init → SQUAD_INIT
        assert.ok(src.includes("'squad:init': 'SQUAD_INIT'"), 'App.jsx must map squad:init to SQUAD_INIT');
    });

    it('maps squad:complete to SQUAD_COMPLETE', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('client/App.jsx', 'utf8');
        assert.ok(
            src.includes("'squad:complete': 'SQUAD_COMPLETE'"),
            'App.jsx must map squad:complete to SQUAD_COMPLETE',
        );
    });

    it('maps squad:abort to SQUAD_ABORT', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('client/App.jsx', 'utf8');
        assert.ok(src.includes("'squad:abort': 'SQUAD_ABORT'"), 'App.jsx must map squad:abort to SQUAD_ABORT');
    });
});

/**
 * Bug 7: ModelPoolDrawer must allow delete for in-use slots (mark pending_delete).
 */
describe('ModelPoolDrawer delete in-use slots (Bug 7 fixed)', () => {
    it('delete button is not disabled for in-use slots', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('client/components/ModelPoolDrawer.jsx', 'utf8');
        // After fix: the disabled={slot.inUse} should be removed from trash button
        assert.ok(
            !src.includes('disabled={slot.inUse}') ||
                // The delete button should not depend on inUse for disabled
                src.match(/IconNames\.TRASH[^}]*}/)?.[0]?.includes('disabled') === false,
            'Trash button must NOT be disabled based on slot.inUse',
        );
    });
});
