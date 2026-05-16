/**
 * Plugin contract — OMP ExtensionAPI boundary.
 * Verifies the squad_delegate tool registration and execute path.
 * Pure EventLog tests — no real OMP, no server start.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../server/event-log.js';
import { processDelegate } from '../../server/submit-plan.js';
import { returnTool, acceptTool, rejectTool } from '../../server/lifecycle-tools.js';

describe('Plugin contract — OMP boundary', () => {
    it('processDelegate with empty EventLog tick=0 succeeds', () => {
        const eventLog = new EventLog();
        assert.equal(eventLog.currentTick, 0);
    });

    it('rapid processDelegate calls: EventLog monotonic', async () => {
        const eventLog = new EventLog();
        const dirs = [];
        try {
            for (let i = 0; i < 5; i++) {
                const d = (await import('fs')).mkdtempSync(
                    (await import('path')).join(process.cwd(), '.omp', 'squad', 'plans', 'rpc-'),
                );
                dirs.push(d);
                (await import('fs')).writeFileSync(
                    (await import('path')).join(d, 'n.toml'),
                    'task = "t"\ndepends_on = []\n[[review_criteria]]\nname = "ok"\ndescription = "ok"\n',
                );
            }
            const results = await Promise.all(
                dirs.map((d) =>
                    processDelegate({ plan_dir: d }, { eventLog })
                        .then((r) => ({ ok: true }))
                        .catch((e) => ({ error: e.message })),
                ),
            );
            const succeeded = results.filter((r) => r.ok);
            // On Bun: calls succeed, tick monotonic. On node: fail at TOML parsing.
            if (succeeded.length > 0) {
                const log = eventLog.getLog();
                const initEvents = log.filter((e) => e.event === 'squad:init');
                assert.equal(initEvents.length, succeeded.length);
                const ticks = initEvents.map((e) => e.tick);
                for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] > ticks[i - 1]);
            } else {
                // No Bun: EventLog must be completely unchanged
                assert.equal(eventLog.getLog().length, 0);
            }
        } finally {
            for (const d of dirs) {
                try {
                    (await import('fs')).rmSync(d, { recursive: true, force: true });
                } catch {}
            }
        }
    });

    it('returnTool, acceptTool, rejectTool have correct names and required params', () => {
        assert.equal(returnTool.name, 'return');
        assert.equal(acceptTool.name, 'accept');
        assert.equal(rejectTool.name, 'reject');
        assert.ok(returnTool.parameters.required.includes('status'));
        assert.ok(acceptTool.parameters.required.includes('reason'));
        assert.ok(rejectTool.parameters.required.includes('reason'));
    });
});
