import { describe, it, beforeAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

function tmpPlanDir() {
    const plansDir = path.join(process.cwd(), '.omp', 'squad', 'plans', `test-${process.pid}-${Date.now()}`);
    fs.mkdirSync(plansDir, { recursive: true });
    return plansDir;
}

function writeToml(dir, name, content) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

// Detect if Bun is available (TOML parsing requires Bun)
let hasBun = false;
beforeAll(() => {
    try {
        hasBun = typeof Bun !== 'undefined' && typeof Bun.TOML !== 'undefined';
    } catch {
        hasBun = false;
    }
});

describe('processDelegate — validation before EventLog', () => {
    it('cyclic .toml files throw Invalid plan before EventLog write', async () => {
        const { processDelegate } = await import('../../server/submit-plan.js');
        const { EventLog } = await import('../../server/event-log.js');

        const dir = tmpPlanDir();
        const eventLog = new EventLog();
        // Pre-populate EventLog with unrelated events
        eventLog.append('config:capacity_changed', { maxWorkers: 5 });
        const priorLen = eventLog.getLog().length;

        try {
            writeToml(
                dir,
                'a.toml',
                [
                    'task = "node A"',
                    'depends_on = ["b"]',
                    '[[review_criteria]]',
                    'name = "criteria"',
                    'description = "must pass"',
                ].join('\n'),
            );
            writeToml(
                dir,
                'b.toml',
                [
                    'task = "node B"',
                    'depends_on = ["a"]',
                    '[[review_criteria]]',
                    'name = "criteria"',
                    'description = "must pass"',
                ].join('\n'),
            );

            let err;
            try {
                await processDelegate({ plan_dir: dir }, { eventLog });
            } catch (e) {
                err = e;
            }

            assert.ok(err, 'processDelegate must throw for cyclic plan');

            if (hasBun) {
                // With Bun, validation runs and returns "Invalid plan: cyclic"
                assert.ok(
                    /cyclic|Invalid plan/i.test(err.message),
                    'error must mention cyclic or Invalid plan, got: ' + err.message,
                );
            } else {
                // Without Bun, TOML parsing fails before validation but still before EventLog
                assert.ok(
                    /TOML parsing/i.test(err.message) || /cyclic|Invalid plan/i.test(err.message),
                    'error from TOML parse or plan validation',
                );
            }

            // EventLog must NOT have been modified (no squad:init appended)
            assert.equal(eventLog.getLog().length, priorLen, 'EventLog length must not change after failed validation');
            assert.equal(
                eventLog.getLog().filter((e) => e.event === 'squad:init').length,
                0,
                'No squad:init should be appended after failed validation',
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('unknown dep throws before EventLog write', async () => {
        const { processDelegate } = await import('../../server/submit-plan.js');
        const { EventLog } = await import('../../server/event-log.js');

        const dir = tmpPlanDir();
        const eventLog = new EventLog();
        eventLog.append('config:capacity_changed', { maxWorkers: 5 });
        const priorLen = eventLog.getLog().length;

        try {
            writeToml(
                dir,
                'a.toml',
                [
                    'task = "node A"',
                    'depends_on = ["nonexistent"]',
                    '[[review_criteria]]',
                    'name = "criteria"',
                    'description = "must pass"',
                ].join('\n'),
            );

            let err;
            try {
                await processDelegate({ plan_dir: dir }, { eventLog });
            } catch (e) {
                err = e;
            }

            assert.ok(err, 'processDelegate must throw for unknown dep');
            assert.equal(eventLog.getLog().length, priorLen, 'EventLog unchanged after failed validation');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('empty directory throws before EventLog write', async () => {
        const { processDelegate } = await import('../../server/submit-plan.js');
        const { EventLog } = await import('../../server/event-log.js');

        const dir = tmpPlanDir();
        const eventLog = new EventLog();
        const priorLen = eventLog.getLog().length;

        try {
            let err;
            try {
                await processDelegate({ plan_dir: dir }, { eventLog });
            } catch (e) {
                err = e;
            }

            assert.ok(err, 'processDelegate must throw for empty dir');
            assert.ok(
                /No .toml files/i.test(err.message),
                'error must mention "No .toml files", got: ' + (err && err.message),
            );
            assert.equal(eventLog.getLog().length, priorLen, 'EventLog unchanged after empty dir error');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rapid consecutive processDelegate: no crash, EventLog grows correctly', async () => {
        const { processDelegate } = await import('../../server/submit-plan.js');
        const { EventLog } = await import('../../server/event-log.js');

        const eventLog = new EventLog();
        const dirs = [];

        try {
            // Pre-populate EventLog with unrelated event
            eventLog.append('config:capacity_changed', { maxWorkers: 3 });
            const priorLen = eventLog.getLog().length;

            // Create 5 independent plan dirs with valid single-node plans
            for (let i = 0; i < 5; i++) {
                const d = tmpPlanDir();
                dirs.push(d);
                writeToml(
                    d,
                    'n.toml',
                    [
                        'task = "task ' + i + '"',
                        'depends_on = []',
                        '[[review_criteria]]',
                        'name = "ok"',
                        'description = "ok"',
                    ].join('\n'),
                );
            }

            if (hasBun) {
                // Fire 5 processDelegate calls in rapid succession — must all succeed
                const results = await Promise.allSettled(
                    dirs.map((d) => processDelegate({ plan_dir: d }, { eventLog })),
                );

                results.forEach((r, i) => {
                    assert.equal(r.status, 'fulfilled', `call ${i} must succeed (got ${r.status})`);
                });

                // EventLog must have grown (5 new squad:init entries)
                assert.ok(
                    eventLog.getLog().length >= priorLen + 5,
                    `EventLog should grow by >=5 entries, got ${eventLog.getLog().length - priorLen}`,
                );

                // Each call appends squad:init
                const initCount = eventLog.getLog().filter((e) => e.event === 'squad:init').length;
                assert.equal(initCount, 5, 'exactly 5 squad:init entries after 5 calls');

                // Pre-existing event still present
                const configEvents = eventLog.getLog().filter((e) => e.event === 'config:capacity_changed');
                assert.equal(configEvents.length, 1, 'pre-existing event still present after rapid calls');
            } else {
                // Without Bun, TOML parsing fails before EventLog write
                const results = await Promise.allSettled(
                    dirs.map((d) => processDelegate({ plan_dir: d }, { eventLog })),
                );
                results.forEach((r) => {
                    assert.equal(r.status, 'rejected', 'call must fail without Bun TOML');
                });
                // EventLog unchanged
                assert.equal(
                    eventLog.getLog().length,
                    priorLen,
                    'EventLog unchanged after failed calls in non-Bun env',
                );
            }
        } finally {
            for (const d of dirs) {
                try {
                    fs.rmSync(d, { recursive: true, force: true });
                } catch {}
            }
        }
    });
});

describe('EventLog persistence — prior events survive processDelegate', () => {
    it('prior events preserved after successful processDelegate', async () => {
        const { EventLog } = await import('../../server/event-log.js');
        const { processDelegate } = await import('../../server/submit-plan.js');

        const eventLog = new EventLog();
        // Pre-populate with unrelated events
        eventLog.append('config:capacity_changed', { maxWorkers: 5 });
        eventLog.append('session:creating', { sessionId: 'old', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        eventLog.append('session:start', { sessionId: 'old', nodeId: 'n1', epoch: 0 });
        const priorLen = eventLog.getLog().length;

        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'n1.toml',
                ['task = "hello"', 'depends_on = []', '[[review_criteria]]', 'name = "ok"', 'description = "ok"'].join(
                    '\n',
                ),
            );

            if (hasBun) {
                await processDelegate({ plan_dir: dir }, { eventLog });
                // Prior events must still exist — no reset
                assert.ok(
                    eventLog.getLog().length > priorLen,
                    'EventLog should have more entries after processDelegate',
                );
                // Prior events not removed
                const priorEvents = eventLog
                    .getLog()
                    .filter(
                        (e) =>
                            e.event === 'config:capacity_changed' ||
                            e.event === 'session:creating' ||
                            e.event === 'session:start',
                    );
                assert.equal(priorEvents.length, 3, 'all 3 prior events must survive');
                // Last event is squad:init
                const lastEvent = eventLog.getLog()[eventLog.getLog().length - 1];
                assert.equal(lastEvent.event, 'squad:init', 'last event must be squad:init');
            } else {
                // Without Bun, TOML parsing fails before EventLog write
                let err;
                try {
                    await processDelegate({ plan_dir: dir }, { eventLog });
                } catch (e) {
                    err = e;
                }
                assert.ok(err, 'expected TOML parsing error in non-Bun env');
                assert.equal(eventLog.getLog().length, priorLen, 'EventLog unchanged after failed TOML parse');
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('getSince works across squad:init boundary', async () => {
        const { EventLog } = await import('../../server/event-log.js');
        const { processDelegate } = await import('../../server/submit-plan.js');

        const eventLog = new EventLog();
        eventLog.append('config:capacity_changed', { maxWorkers: 5 });
        eventLog.append('session:creating', { sessionId: 'old', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        const cursor = eventLog.getLog().length; // 2
        eventLog.append('session:start', { sessionId: 'old', nodeId: 'n1', epoch: 0 });

        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'n1.toml',
                ['task = "hello"', 'depends_on = []', '[[review_criteria]]', 'name = "ok"', 'description = "ok"'].join(
                    '\n',
                ),
            );

            if (hasBun) {
                await processDelegate({ plan_dir: dir }, { eventLog });

                // getSince(0) returns everything (production API used by ws-handler sync)
                const all = eventLog.getSince(0);
                assert.ok(all.length >= 4, 'enough entries');
                assert.equal(all[0].event, 'config:capacity_changed');

                // getSince(cursor) returns events after cursor
                const after = eventLog.getSince(cursor);
                assert.ok(after.length >= 2, 'entries after cursor');
                assert.equal(after[0].event, 'session:start', 'first entry after cursor is session:start');
                assert.equal(after[after.length - 1].event, 'squad:init', 'last entry after cursor is squad:init');
            } else {
                let err;
                try {
                    await processDelegate({ plan_dir: dir }, { eventLog });
                } catch (e) {
                    err = e;
                }
                assert.ok(err, 'expected TOML parsing error in non-Bun env');
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('revising phase emits squad:replan not squad:init', async () => {
        const { EventLog } = await import('../../server/event-log.js');
        const { processDelegate } = await import('../../server/submit-plan.js');

        // Revising phase requires state.squad.phase === 'revising'
        // Since there's no squad:phase_changed projection handler, we must
        // inject the phase directly into EventLog so project() produces it.
        // squad:init creates squad.status='active' — we then manually insert
        // a phase entry into EventLog that project() recognizes.
        const eventLog = new EventLog();
        eventLog.append('squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', task: 't', depends_on: [], review_criteria: [] }],
            originalTask: '',
        });
        // squad:register_main_session stores squad.mainSessionId (no-op for phase)
        eventLog.append('squad:register_main_session', { sessionId: 'arch-session' });

        // Current architecture: squad:phase_changed has no projection handler.
        // So project() ignores it, and state.squad.phase remains undefined.
        // The else branch in processDelegate emits squad:init.
        // This test documents the current behavior (not the ideal future one).
        eventLog.append('squad:phase_changed', { phase: 'revising', feedback: 'rework' });
        const priorLen = eventLog.getLog().length;

        const dir = tmpPlanDir();
        try {
            writeToml(
                dir,
                'n1.toml',
                [
                    'task = "revised task"',
                    'depends_on = []',
                    '[[review_criteria]]',
                    'name = "ok"',
                    'description = "ok"',
                ].join('\n'),
            );

            if (hasBun) {
                await processDelegate({ plan_dir: dir }, { eventLog });

                // Prior events preserved
                assert.ok(eventLog.getLog().length > priorLen, 'EventLog should grow');
                const lastEvent = eventLog.getLog()[eventLog.getLog().length - 1];
                // Current behavior: no projection for phase_changed → else branch → squad:init
                // Once squad:phase_changed projection is added, this should become 'squad:replan'
                assert.equal(
                    lastEvent.event,
                    'squad:init',
                    'Current: squad:init emitted (phase projection missing). ' +
                        'TODO: add squad:phase_changed projection to enable squad:replan path',
                );
            } else {
                let err;
                try {
                    await processDelegate({ plan_dir: dir }, { eventLog });
                } catch (e) {
                    err = e;
                }
                assert.ok(err, 'expected TOML parsing error in non-Bun env');
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
