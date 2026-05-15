import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeToml(dir, name, content) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

function tmpPlanDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'squad-regression-'));
}

// ── Regression: validation before EventLog (REPAIR.md §2.1 + submit-plan.js reorder) ──
// processDelegate must validate plan structure before requiring EventLog,
// so cyclic dep errors surface as "Invalid plan: cyclic" not "EventLog not initialized".
describe('submit-plan validation ordering regression', () => {
    test('cyclic dependency fails before EventLog check', async () => {
        const { processDelegate } = await import('../../server/submit-plan.js');
        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'a.toml',
                `
task = "node A"
depends_on = ["b"]
[[review_criteria]]
name = "works"
description = "does it work"
`,
            );
            writeToml(
                dir,
                'b.toml',
                `
task = "node B"
depends_on = ["a"]
[[review_criteria]]
name = "works"
description = "does it work"
`,
            );
            let err;
            try {
                await processDelegate({ plan_dir: dir });
            } catch (e) {
                err = e;
            }
            expect(err).toBeDefined();
            // MUST say "cyclic" or "Invalid plan", NOT "EventLog not initialized"
            expect(err.message).toMatch(/cyclic|Invalid plan/i);
            expect(err.message).not.toMatch(/EventLog not initialized/i);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('unknown dependency fails before EventLog check', async () => {
        const { processDelegate } = await import('../../server/submit-plan.js');
        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'a.toml',
                `
task = "node A"
depends_on = ["nonexistent"]
[[review_criteria]]
name = "works"
description = "does it work"
`,
            );
            let err;
            try {
                await processDelegate({ plan_dir: dir });
            } catch (e) {
                err = e;
            }
            expect(err).toBeDefined();
            expect(err.message).toMatch(/unknown|Invalid plan/i);
            expect(err.message).not.toMatch(/EventLog not initialized/i);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('empty directory fails with clear error', async () => {
        const { processDelegate } = await import('../../server/submit-plan.js');
        const dir = tmpPlanDir();
        try {
            let err;
            try {
                await processDelegate({ plan_dir: dir });
            } catch (e) {
                err = e;
            }
            expect(err).toBeDefined();
            expect(err.message).toMatch(/No .toml files/i);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ── Regression: eventLog.reset removal (PROB.md Fatal 1) ──
// processDelegate must NOT call eventLog.reset() or discardNDJSON().
// The append-only EventLog is sacred: prior events survive squad:init.
// WebSocket sync cursors (getSince) must continue to work across plan submissions.
describe('eventLog.reset removal regression', () => {
    test('prior events preserved after non-revising processDelegate', async () => {
        const { EventLog } = await import('../../server/event-log.js');
        const { processDelegate } = await import('../../server/submit-plan.js');

        const eventLog = new EventLog();
        // Simulate prior session events with valid projection sequences
        eventLog.append('config:capacity_changed', { maxWorkers: 5 });
        eventLog.append('session:creating', { sessionId: 'old', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        eventLog.append('session:start', { sessionId: 'old', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        const priorLen = eventLog.length;

        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'n1.toml',
                'task = "hello"\ndepends_on = []\n[[review_criteria]]\nname = "ok"\ndescription = "ok"\n',
            );
            await processDelegate({ plan_dir: dir }, { eventLog });
            // Prior events must still exist — no reset
            expect(eventLog.length).toBeGreaterThan(priorLen);
            // Prior events not removed
            const priorEvents = eventLog.log.filter(
                (e) =>
                    e.event === 'config:capacity_changed' ||
                    e.event === 'session:creating' ||
                    e.event === 'session:start',
            );
            expect(priorEvents.length).toBe(3);
            // Last event is squad:init
            expect(eventLog.log[eventLog.log.length - 1].event).toBe('squad:init');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('getSince works across squad:init boundary', async () => {
        const { EventLog } = await import('../../server/event-log.js');
        const { processDelegate } = await import('../../server/submit-plan.js');

        const eventLog = new EventLog();
        eventLog.append('config:capacity_changed', { maxWorkers: 5 });
        eventLog.append('session:creating', { sessionId: 'old', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        const cursor = eventLog.length; // 2
        eventLog.append('session:start', { sessionId: 'old', nodeId: 'n1', phase: 'authoring', epoch: 0 });

        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'n1.toml',
                'task = "hello"\ndepends_on = []\n[[review_criteria]]\nname = "ok"\ndescription = "ok"\n',
            );
            await processDelegate({ plan_dir: dir }, { eventLog });

            // getSince(0) returns everything including prior events
            const all = eventLog.getSince(0);
            expect(all.length).toBe(eventLog.length);
            expect(all[0].event).toBe('config:capacity_changed');

            // getSince(cursor=2) returns events after cursor
            const after = eventLog.getSince(cursor);
            expect(after.length).toBe(eventLog.length - cursor);
            expect(after[0].event).toBe('session:start');
            expect(after[after.length - 1].event).toBe('squad:init');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('revising branch also preserves prior events', async () => {
        const { EventLog } = await import('../../server/event-log.js');
        const { processDelegate } = await import('../../server/submit-plan.js');

        // Build state with squad.phase === 'revising' via squad:init + squad:phase_changed
        const eventLog = new EventLog();
        eventLog.append('squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', task: 't', depends_on: [] }],
            originalTask: '',
        });
        eventLog.append('squad:phase_changed', { phase: 'revising', feedback: 'rework' });
        const priorLen = eventLog.length;

        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'n1.toml',
                'task = "revised task"\ndepends_on = []\n[[review_criteria]]\nname = "ok"\ndescription = "ok"\n',
            );
            await processDelegate({ plan_dir: dir }, { eventLog });

            // Prior events preserved
            expect(eventLog.length).toBeGreaterThan(priorLen);
            expect(eventLog.log[eventLog.log.length - 1].event).toBe('squad:replan');
            // Original events still there
            expect(eventLog.log.filter((e) => e.event === 'squad:init').length).toBe(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
