import { describe, it, expect } from 'bun:test';
import { validatePlan } from '../../server/validate-plan.js';

const node = (overrides = {}) => ({ id: 'n1', task: 't', review_criteria: 'r', ...overrides });
const check = (plan, errorFragment) => {
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(errorFragment))).toBe(true);
};

describe('validatePlan', () => {
    it('flags missing/invalid mode', () => {
        check({ nodes: [node()] }, 'plan.mode must be "M" or "L"');
        check({ mode: 'X', nodes: [node()] }, 'plan.mode must be "M" or "L"');
    });

    it('flags M mode with >1 node', () => {
        check({ mode: 'M', nodes: [node({ id: 'a' }), node({ id: 'b' })] }, 'M mode requires exactly one node');
    });

    it('flags M mode node with depends_on', () => {
        check({ mode: 'M', nodes: [node({ depends_on: [] })] }, 'not allowed in M mode');
    });

    it('flags missing required node fields', () => {
        const { id, task, review_criteria, ...noId } = node();
        check({ mode: 'L', nodes: [noId] }, 'node[0].id');
        const { id: _, task: _t, review_criteria: _r, ...noTask } = node();
        check({ mode: 'L', nodes: [noTask] }, 'node[0].task');
        const { id: _2, task: _t2, review_criteria: _rc, ...noRc } = node();
        check({ mode: 'L', nodes: [noRc] }, 'node[0].review_criteria');
    });

    it('flags duplicate node IDs', () => {
        check({ mode: 'L', nodes: [node(), node({ task: 't2', review_criteria: 'r2' })] }, 'duplicated');
    });

    it('flags empty nodes array', () => {
        check({ mode: 'L', nodes: [] }, 'must not be empty');
    });

    it('flags non-string node id', () => {
        check({ mode: 'L', nodes: [{ id: 123, task: 't', review_criteria: 'r' }] }, 'non-empty string');
    });

    it('flags non-array depends_on', () => {
        check({ mode: 'L', nodes: [node({ depends_on: 'x' })] }, 'must be an array');
    });

    it('accepts valid review_criteria as array of objects', () => {
        const result = validatePlan({
            mode: 'L',
            nodes: [node({ review_criteria: [{ name: 'n', description: 'd' }] })],
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('flags invalid review_criteria shapes', () => {
        check({ mode: 'L', nodes: [node({ review_criteria: [] })] }, 'review_criteria must not be empty');
        check({ mode: 'L', nodes: [node({ review_criteria: ['', 'b'] })] }, 'review_criteria[0] must not be empty');
        check(
            { mode: 'L', nodes: [node({ review_criteria: [{ name: 'n' }] })] },
            'review_criteria[0].description must be a non-empty string',
        );
        check(
            { mode: 'L', nodes: [node({ review_criteria: [{ description: 'd' }] })] },
            'review_criteria[0].name must be a non-empty string',
        );
        check(
            { mode: 'L', nodes: [node({ review_criteria: [{ name: '', description: 'd' }] })] },
            'review_criteria[0].name must be a non-empty string',
        );
        check(
            { mode: 'L', nodes: [node({ review_criteria: [{ name: 'n', description: '' }] })] },
            'review_criteria[0].description must be a non-empty string',
        );
        check(
            { mode: 'L', nodes: [node({ review_criteria: 123 })] },
            'review_criteria must be a non-empty string, array of strings, or array of {name, description} objects',
        );
    });

    it('accepts valid M mode plan', () => {
        const result = validatePlan({ mode: 'M', nodes: [node()] });
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('accepts valid L mode plan with depends_on', () => {
        const result = validatePlan({
            mode: 'L',
            nodes: [node(), node({ id: 'n2', task: 't2', review_criteria: 'r2', depends_on: ['n1'] })],
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
});
