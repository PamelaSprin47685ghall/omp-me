import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Regression: validation before EventLog (REPAIR.md §2.1 + submit-plan.js reorder) ──
// processDelegate must validate plan structure before requiring EventLog,
// so cyclic dep errors surface as "Invalid plan: cyclic" not "EventLog not initialized".
describe('submit-plan validation ordering regression', () => {
    function writeToml(dir, name, content) {
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }

    function tmpPlanDir() {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'squad-regression-'));
    }

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
