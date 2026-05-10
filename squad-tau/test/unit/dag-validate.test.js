import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateNodes } from '../../server/dag-validate.js';

describe('validateNodes', () => {
    it('rejects null input', () => {
        const result = validateNodes(null);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.errors.length, 1);
        assert.match(result.errors[0], /nodes must be a non-empty array/);
    });

    it('rejects undefined input', () => {
        const result = validateNodes(undefined);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.errors.length, 1);
        assert.match(result.errors[0], /nodes must be a non-empty array/);
    });

    it('rejects empty array', () => {
        const result = validateNodes([]);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.errors.length, 1);
        assert.match(result.errors[0], /nodes must be a non-empty array/);
    });

    it('detects duplicate node IDs', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B' },
            { id: 'A', task: 'task A2', review_criteria: 'criteria A2' },
        ];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('duplicate node id: "A"')));
    });

    it('detects multiple duplicate IDs', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'A', task: 'task A2', review_criteria: 'criteria A2' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B' },
            { id: 'B', task: 'task B2', review_criteria: 'criteria B2' },
        ];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('duplicate node id: "A"')));
        assert.ok(result.errors.some((e) => e.includes('duplicate node id: "B"')));
    });

    it('flags node missing id field', () => {
        const nodes = [{ task: 'task A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('missing required fields') && e.includes('id')));
    });

    it('flags node missing task field', () => {
        const nodes = [{ id: 'A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('missing required fields') && e.includes('task')));
    });

    it('flags node missing review_criteria field', () => {
        const nodes = [{ id: 'A', task: 'task A' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('missing required fields') && e.includes('review_criteria')));
    });

    it('flags node with empty string id', () => {
        const nodes = [{ id: '', task: 'task A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('missing required fields') && e.includes('id')));
    });

    it('flags node with empty string task', () => {
        const nodes = [{ id: 'A', task: '', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('missing required fields') && e.includes('task')));
    });

    it('flags node with empty string review_criteria', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: '' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('missing required fields') && e.includes('review_criteria')));
    });

    it('flags multiple missing fields on same node', () => {
        const nodes = [{ id: 'A' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(
            result.errors.some(
                (e) => e.includes('missing required fields') && e.includes('task') && e.includes('review_criteria'),
            ),
        );
    });

    it('detects unknown dependency', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B', depends_on: ['X'] },
        ];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('node "B" depends on unknown node: "X"')));
    });

    it('detects multiple unknown dependencies', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B', depends_on: ['X', 'Y'] },
        ];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('depends on unknown node: "X"')));
        assert.ok(result.errors.some((e) => e.includes('depends on unknown node: "Y"')));
    });

    it('accepts valid single node', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    });

    it('accepts valid multiple nodes without dependencies', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B' },
            { id: 'C', task: 'task C', review_criteria: 'criteria C' },
        ];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    });

    it('accepts valid nodes with correct dependencies', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'B', task: 'task B', review_criteria: 'criteria B', depends_on: ['A'] },
            { id: 'C', task: 'task C', review_criteria: 'criteria C', depends_on: ['A', 'B'] },
        ];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    });

    it('accepts node with empty depends_on array', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A', depends_on: [] }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    });

    it('ignores depends_on when not an array', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A', depends_on: 'B' }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    });

    it('accumulates multiple error types', () => {
        const nodes = [
            { id: 'A', task: 'task A', review_criteria: 'criteria A' },
            { id: 'A', task: 'task A2', review_criteria: 'criteria A2' },
            { task: 'task B', review_criteria: 'criteria B' },
            { id: 'C', task: 'task C', review_criteria: 'criteria C', depends_on: ['X'] },
        ];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.length >= 3);
        assert.ok(result.errors.some((e) => e.includes('duplicate node id: "A"')));
        assert.ok(result.errors.some((e) => e.includes('missing required fields') && e.includes('id')));
        assert.ok(result.errors.some((e) => e.includes('depends on unknown node: "X"')));
    });

    it('accepts nodes with extra fields', () => {
        const nodes = [{ id: 'A', task: 'task A', review_criteria: 'criteria A', extra: 'data', another: 123 }];
        const result = validateNodes(nodes);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    });
});
