import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../../server/validate-plan.js';

describe('validatePlan — cyclic and unknown dep detection', () => {
    it('rejects cyclic A→B→A', () => {
        const result = validatePlan({
            mode: 'L',
            nodes: [
                { id: 'A', depends_on: ['B'] },
                { id: 'B', depends_on: ['A'] },
            ],
        });
        assert.ok(!result.valid);
        assert.ok(result.errors.some((e) => /cyclic/i.test(e)));
    });

    it('rejects self-referential node', () => {
        const result = validatePlan({
            mode: 'M',
            nodes: [{ id: 'n1', depends_on: ['n1'] }],
        });
        assert.ok(!result.valid);
        assert.ok(result.errors.some((e) => /cyclic/i.test(e)));
    });

    it('rejects unknown dependency', () => {
        const result = validatePlan({
            mode: 'L',
            nodes: [{ id: 'n1', depends_on: ['nonexistent'] }],
        });
        assert.ok(!result.valid);
        assert.ok(result.errors.some((e) => /unknown/i.test(e)));
    });

    it('accepts valid acyclic plan', () => {
        const result = validatePlan({
            mode: 'L',
            nodes: [
                { id: 'n1', depends_on: [] },
                { id: 'n2', depends_on: ['n1'] },
            ],
        });
        assert.ok(result.valid);
        assert.equal(result.errors.length, 0);
    });

    it('accepts empty node list', () => {
        const result = validatePlan({ mode: 'M', nodes: [] });
        assert.ok(result.valid);
    });
});
