import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { topologicalSort } from '../../server/dag-sort.js';

describe('topologicalSort', () => {
    it('throws on empty input', () => {
        for (const input of [null, undefined, []])
            assert.throws(() => topologicalSort(input), /nodes array cannot be empty/);
    });

    it('single node with no deps returns single layer', () => {
        assert.deepStrictEqual(topologicalSort([{ id: 'A' }]), { layers: [['A']] });
    });

    it('multiple nodes with no deps return single layer', () => {
        const { layers } = topologicalSort([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
        assert.strictEqual(layers.length, 1);
        assert.strictEqual(layers[0].length, 3);
        for (const id of ['A', 'B', 'C']) assert.ok(layers[0].includes(id));
    });

    it('A->B->C chain returns three layers', () => {
        const nodes = [{ id: 'A' }, { id: 'B', depends_on: ['A'] }, { id: 'C', depends_on: ['B'] }];
        assert.deepStrictEqual(topologicalSort(nodes), { layers: [['A'], ['B'], ['C']] });
    });

    it('declaration order does not affect chain result', () => {
        const nodes = [{ id: 'C', depends_on: ['B'] }, { id: 'A' }, { id: 'B', depends_on: ['A'] }];
        assert.deepStrictEqual(topologicalSort(nodes), { layers: [['A'], ['B'], ['C']] });
    });

    it('diamond A->B, A->C, B->D, C->D returns [A], [B,C], [D]', () => {
        const nodes = [
            { id: 'A' },
            { id: 'B', depends_on: ['A'] },
            { id: 'C', depends_on: ['A'] },
            { id: 'D', depends_on: ['B', 'C'] },
        ];
        const { layers } = topologicalSort(nodes);
        assert.strictEqual(layers.length, 3);
        assert.deepStrictEqual(layers[0], ['A']);
        assert.strictEqual(layers[1].length, 2);
        assert.ok(layers[1].includes('B') && layers[1].includes('C'));
        assert.deepStrictEqual(layers[2], ['D']);
    });

    it('handles mixed parallel and sequential dependencies', () => {
        const nodes = [
            { id: 'A' },
            { id: 'B' },
            { id: 'C', depends_on: ['A'] },
            { id: 'D', depends_on: ['A', 'B'] },
            { id: 'E', depends_on: ['C', 'D'] },
        ];
        const { layers } = topologicalSort(nodes);
        assert.strictEqual(layers.length, 3);
        assert.strictEqual(layers[0].length, 2);
        assert.strictEqual(layers[1].length, 2);
        assert.deepStrictEqual(layers[2], ['E']);
    });

    it('throws on self-loop cycle', () => {
        assert.throws(() => topologicalSort([{ id: 'A', depends_on: ['A'] }]), /cycle detected involving nodes: A/);
    });

    it('throws on two-node and three-node cycles', () => {
        const two = [
            { id: 'A', depends_on: ['B'] },
            { id: 'B', depends_on: ['A'] },
        ];
        assert.throws(() => topologicalSort(two), /cycle detected involving nodes/);
        const three = [
            { id: 'A', depends_on: ['C'] },
            { id: 'B', depends_on: ['A'] },
            { id: 'C', depends_on: ['B'] },
        ];
        assert.throws(() => topologicalSort(three), /cycle detected involving nodes/);
    });

    it('throws on cycle embedded in larger graph', () => {
        const nodes = [
            { id: 'root' },
            { id: 'A', depends_on: ['root'] },
            { id: 'B', depends_on: ['A'] },
            { id: 'C', depends_on: ['B', 'D'] },
            { id: 'D', depends_on: ['C'] },
        ];
        assert.throws(() => topologicalSort(nodes), /cycle detected involving nodes/);
    });

    it('throws when dependency does not exist', () => {
        assert.throws(
            () => topologicalSort([{ id: 'A' }, { id: 'B', depends_on: ['X'] }]),
            /node B depends on non-existent node X/,
        );
    });

    it('handles large fan-out and fan-in', () => {
        const range = (n) => Array.from({ length: n }, (_, i) => i);
        const fanOut = [{ id: 'root' }, ...range(10).map((i) => ({ id: `c${i}`, depends_on: ['root'] }))];
        const out = topologicalSort(fanOut);
        assert.strictEqual(out.layers.length, 2);
        assert.strictEqual(out.layers[1].length, 10);

        const fanIn = [
            ...range(10).map((i) => ({ id: `s${i}` })),
            { id: 'sink', depends_on: range(10).map((i) => `s${i}`) },
        ];
        const inn = topologicalSort(fanIn);
        assert.strictEqual(inn.layers.length, 2);
        assert.strictEqual(inn.layers[0].length, 10);
    });
});
