import { describe, it, expect } from 'bun:test';
import { topologicalSort } from '../../server/dag-sort.js';

describe('topologicalSort', () => {
    it('throws on empty input', () => {
        for (const input of [null, undefined, []])
            expect(() => topologicalSort(input)).toThrow(/nodes array cannot be empty/);
    });

    it('single node with no deps returns single layer', () => {
        expect(topologicalSort([{ id: 'A' }])).toEqual([[{ id: 'A' }]]);
    });

    it('multiple nodes with no deps return single layer', () => {
        const layers = topologicalSort([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
        expect(layers.length).toBe(1);
        expect(layers[0].length).toBe(3);
        const ids = layers[0].map((n) => n.id);
        for (const id of ['A', 'B', 'C']) expect(ids.includes(id)).toBeTruthy();
    });

    it('A->B->C chain returns three layers', () => {
        const nodes = [{ id: 'A' }, { id: 'B', depends_on: ['A'] }, { id: 'C', depends_on: ['B'] }];
        expect(topologicalSort(nodes)).toEqual([
            [{ id: 'A' }],
            [{ id: 'B', depends_on: ['A'] }],
            [{ id: 'C', depends_on: ['B'] }],
        ]);
    });

    it('declaration order does not affect chain result', () => {
        const nodes = [{ id: 'C', depends_on: ['B'] }, { id: 'A' }, { id: 'B', depends_on: ['A'] }];
        const layers = topologicalSort(nodes);
        expect(layers.map((l) => l.map((n) => n.id))).toEqual([['A'], ['B'], ['C']]);
    });

    it('diamond A->B, A->C, B->D, C->D returns [A], [B,C], [D]', () => {
        const nodes = [
            { id: 'A' },
            { id: 'B', depends_on: ['A'] },
            { id: 'C', depends_on: ['A'] },
            { id: 'D', depends_on: ['B', 'C'] },
        ];
        const layers = topologicalSort(nodes);
        expect(layers.length).toBe(3);
        expect(layers[0].map((n) => n.id)).toEqual(['A']);
        expect(layers[1].length).toBe(2);
        const l1Ids = layers[1].map((n) => n.id);
        expect(l1Ids.includes('B') && l1Ids.includes('C')).toBeTruthy();
        expect(layers[2].map((n) => n.id)).toEqual(['D']);
    });

    it('handles mixed parallel and sequential dependencies', () => {
        const nodes = [
            { id: 'A' },
            { id: 'B' },
            { id: 'C', depends_on: ['A'] },
            { id: 'D', depends_on: ['A', 'B'] },
            { id: 'E', depends_on: ['C', 'D'] },
        ];
        const layers = topologicalSort(nodes);
        expect(layers.length).toBe(3);
        expect(layers[0].length).toBe(2);
        expect(layers[1].length).toBe(2);
        expect(layers[2].map((n) => n.id)).toEqual(['E']);
    });

    it('throws on self-loop cycle', () => {
        expect(() => topologicalSort([{ id: 'A', depends_on: ['A'] }])).toThrow(/cycle detected involving nodes: A/);
    });

    it('throws on two-node and three-node cycles', () => {
        const two = [
            { id: 'A', depends_on: ['B'] },
            { id: 'B', depends_on: ['A'] },
        ];
        expect(() => topologicalSort(two)).toThrow(/cycle detected involving nodes/);
        const three = [
            { id: 'A', depends_on: ['C'] },
            { id: 'B', depends_on: ['A'] },
            { id: 'C', depends_on: ['B'] },
        ];
        expect(() => topologicalSort(three)).toThrow(/cycle detected involving nodes/);
    });

    it('throws on cycle embedded in larger graph', () => {
        const nodes = [
            { id: 'root' },
            { id: 'A', depends_on: ['root'] },
            { id: 'B', depends_on: ['A'] },
            { id: 'C', depends_on: ['B', 'D'] },
            { id: 'D', depends_on: ['C'] },
        ];
        expect(() => topologicalSort(nodes)).toThrow(/cycle detected involving nodes/);
    });

    it('throws when dependency does not exist', () => {
        expect(() => topologicalSort([{ id: 'A' }, { id: 'B', depends_on: ['X'] }])).toThrow(
            /node B depends on non-existent node X/,
        );
    });

    it('handles large fan-out and fan-in', () => {
        const range = (n) => Array.from({ length: n }, (_, i) => i);
        const fanOut = [{ id: 'root' }, ...range(10).map((i) => ({ id: `c${i}`, depends_on: ['root'] }))];
        const out = topologicalSort(fanOut);
        expect(out.length).toBe(2);
        expect(out[1].length).toBe(10);

        const fanIn = [
            ...range(10).map((i) => ({ id: `s${i}` })),
            { id: 'sink', depends_on: range(10).map((i) => `s${i}`) },
        ];
        const inn = topologicalSort(fanIn);
        expect(inn.length).toBe(2);
        expect(inn[0].length).toBe(10);
    });
});
