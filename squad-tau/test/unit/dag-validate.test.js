import { describe, it, expect } from 'bun:test';
import { validateNodes } from '../../server/dag-validate.js';

describe('validateNodes', () => {
    it('rejects null input', () => {
        const result = validateNodes(null);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toMatch(/nodes must be a non-empty array/);
    });

    it('rejects undefined input', () => {
        const result = validateNodes(undefined);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toMatch(/nodes must be a non-empty array/);
    });

    it('rejects empty array', () => {
        const result = validateNodes([]);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toMatch(/nodes must be a non-empty array/);
    });

    it('detects duplicate node IDs', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B' },
            { id: 'A', task: 'task A2', review_criteria: 'criteria A2' },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('duplicate node id: "A"'))).toBeTruthy();
    });

    it('detects multiple duplicate IDs', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'A', task: 'task A2', review_criteria: 'criteria A2' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B' },
            { id: 'B', task: 'task B2', review_criteria: 'criteria B2' },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('duplicate node id: "A"'))).toBeTruthy();
        expect(result.errors.some((e) => e.includes('duplicate node id: "B"'))).toBeTruthy();
    });

    it('flags node missing id field', () => {
        const nodes = [{ task: 'task A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('missing required fields') && e.includes('id'))).toBeTruthy();
    });

    it('flags node missing task field', () => {
        const nodes = [{ id: 'A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('missing required fields') && e.includes('task'))).toBeTruthy();
    });

    it('flags node missing review_criteria field', () => {
        const nodes = [{ id: 'A', task: 'task A' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.includes('missing required fields') && e.includes('review_criteria')),
        ).toBeTruthy();
    });

    it('flags node with empty string id', () => {
        const nodes = [{ id: '', task: 'task A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('missing required fields') && e.includes('id'))).toBeTruthy();
    });

    it('flags node with empty string task', () => {
        const nodes = [{ id: 'A', task: '', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('missing required fields') && e.includes('task'))).toBeTruthy();
    });

    it('flags node with empty string review_criteria', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: '' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.includes('missing required fields') && e.includes('review_criteria')),
        ).toBeTruthy();
    });

    it('flags multiple missing fields on same node', () => {
        const nodes = [{ id: 'A' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) => e.includes('missing required fields') && e.includes('task') && e.includes('review_criteria'),
            ),
        ).toBeTruthy();
    });

    it('detects unknown dependency', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B', depends_on: ['X'] },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('node "B" depends on unknown node: "X"'))).toBeTruthy();
    });

    it('detects multiple unknown dependencies', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B', depends_on: ['X', 'Y'] },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('depends on unknown node: "X"'))).toBeTruthy();
        expect(result.errors.some((e) => e.includes('depends on unknown node: "Y"'))).toBeTruthy();
    });

    it('accepts valid single node', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('accepts valid multiple nodes without dependencies', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B' },
            { id: 'C', task: 'task C', review_criteria: 'criteria C' },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('accepts valid nodes with correct dependencies', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B', depends_on: ['A'] },
            { id: 'C', task: 'task C', review_criteria: 'criteria C', depends_on: ['A', 'B'] },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('accepts node with empty depends_on array', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A', depends_on: [] }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('ignores depends_on when not an array', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A', depends_on: 'B' }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('accumulates multiple error types', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'A', task: 'task A2', review_criteria: 'criteria A2' },
            { task: 'task B', review_criteria: 'criteria B' },
            { id: 'C', task: 'task C', review_criteria: 'criteria C', depends_on: ['X'] },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
        expect(result.errors.some((e) => e.includes('duplicate node id: "A"'))).toBeTruthy();
        expect(result.errors.some((e) => e.includes('missing required fields') && e.includes('id'))).toBeTruthy();
        expect(result.errors.some((e) => e.includes('depends on unknown node: "X"'))).toBeTruthy();
    });

    it('accepts nodes with extra fields', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A', extra: 'data', another: 123 }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
});
