import { describe, test, expect } from 'bun:test';
import { topologicalSort } from '../../server/dag-sort.js';
import { validateNodes } from '../../server/dag-validate.js';
import { STATUS } from '../../server/constants.js';

// Test the DAG execution pipeline components that are independently testable.
// executeDAG and executeLayer depend on runNode (which needs OMP runtime),
// so we test the sorting, validation, and state propagation logic separately.

describe('DAG topological sort integration', () => {
    test('single node produces one layer', () => {
        const nodes = [{ id: 'n1', task: 'T1', review_criteria: 'C1' }];
        const { layers } = topologicalSort(nodes);
        expect(layers.length).toBe(1);
        expect(layers[0]).toEqual(['n1']);
    });

    test('chain dependency produces ordered layers', () => {
        const nodes = [
            { id: 'n1', task: 'T1', review_criteria: 'C1', depends_on: [] },
            { id: 'n2', task: 'T2', review_criteria: 'C2', depends_on: ['n1'] },
            { id: 'n3', task: 'T3', review_criteria: 'C3', depends_on: ['n2'] },
        ];
        const { layers } = topologicalSort(nodes);
        expect(layers.length).toBe(3);
        expect(layers[0]).toEqual(['n1']);
        expect(layers[1]).toEqual(['n2']);
        expect(layers[2]).toEqual(['n3']);
    });

    test('parallel nodes in same layer', () => {
        const nodes = [
            { id: 'n1', task: 'T1', review_criteria: 'C1' },
            { id: 'n2', task: 'T2', review_criteria: 'C2' },
            { id: 'n3', task: 'T3', review_criteria: 'C3' },
        ];
        const { layers } = topologicalSort(nodes);
        expect(layers.length).toBe(1);
        expect(layers[0].sort()).toEqual(['n1', 'n2', 'n3']);
    });

    test('diamond dependency resolves correctly', () => {
        const nodes = [
            { id: 'root', task: 'R', review_criteria: 'C', depends_on: [] },
            { id: 'left', task: 'L', review_criteria: 'C', depends_on: ['root'] },
            { id: 'right', task: 'Ri', review_criteria: 'C', depends_on: ['root'] },
            { id: 'leaf', task: 'Le', review_criteria: 'C', depends_on: ['left', 'right'] },
        ];
        const { layers } = topologicalSort(nodes);
        expect(layers.length).toBe(3);
        expect(layers[0]).toEqual(['root']);
        expect(layers[1].sort()).toEqual(['left', 'right']);
        expect(layers[2]).toEqual(['leaf']);
    });
});

describe('validateNodes integration', () => {
    test('rejects duplicate IDs', () => {
        const nodes = [
            { id: 'n1', task: 'T1', review_criteria: 'C1' },
            { id: 'n1', task: 'T2', review_criteria: 'C2' },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
    });

    test('rejects unknown dependency', () => {
        const nodes = [{ id: 'n1', task: 'T1', review_criteria: 'C1', depends_on: ['nonexistent'] }];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('unknown'))).toBe(true);
    });

    test('rejects empty node list', () => {
        const result = validateNodes([]);
        expect(result.valid).toBe(false);
    });

    test('accepts valid node list', () => {
        const nodes = [
            { id: 'n1', task: 'T1', review_criteria: 'C1' },
            { id: 'n2', task: 'T2', review_criteria: 'C2', depends_on: ['n1'] },
        ];
        const result = validateNodes(nodes);
        expect(result.valid).toBe(true);
    });
});

describe('DAG blocked node propagation (executeDAG logic)', () => {
    test('failed upstream causes blocked downstream', () => {
        // Simulate the blocking logic from dag-execute.js
        const nodes = [
            { id: 'n1', task: 'T1', review_criteria: 'C1' },
            { id: 'n2', task: 'T2', review_criteria: 'C2', depends_on: ['n1'] },
            { id: 'n3', task: 'T3', review_criteria: 'C3', depends_on: ['n2'] },
        ];

        const { layers } = topologicalSort(nodes);
        expect(layers.length).toBe(3);

        // Simulate blocking propagation matching dag-execute.js logic:
        // blocked nodes are added to failedNodes set so downstream sees them
        const failedNodes = new Set(['n1']); // n1 failed

        for (const layer of layers) {
            const blocked = layer.filter((nodeId) => {
                const node = nodes.find((n) => n.id === nodeId);
                return node.depends_on?.some((depId) => failedNodes.has(depId));
            });
            // Add blocked nodes to failed set for downstream propagation
            for (const id of blocked) failedNodes.add(id);

            if (layer[0] === 'n2') {
                expect(blocked).toEqual(['n2']);
            }
            if (layer[0] === 'n3') {
                expect(blocked).toEqual(['n3']);
            }
        }
    });

    test('independent nodes in same layer not affected by failed sibling', () => {
        const nodes = [
            { id: 'n1', task: 'T1', review_criteria: 'C1' },
            { id: 'n2', task: 'T2', review_criteria: 'C2' },
            { id: 'n3', task: 'T3', review_criteria: 'C3', depends_on: ['n1'] },
        ];

        const { layers } = topologicalSort(nodes);
        expect(layers[0].sort()).toEqual(['n1', 'n2']);
        expect(layers[1]).toEqual(['n3']);

        // n1 fails, n2 should still run (no dep), n3 should be blocked
        const failedNodes = new Set(['n1']);

        const layer0Blocked = layers[0].filter((nodeId) => {
            const node = nodes.find((n) => n.id === nodeId);
            return node.depends_on?.some((depId) => failedNodes.has(depId));
        });
        // n2 doesn't depend on n1, so it's not blocked
        expect(layer0Blocked).toEqual([]);

        const layer1Blocked = layers[1].filter((nodeId) => {
            const node = nodes.find((n) => n.id === nodeId);
            return node.depends_on?.some((depId) => failedNodes.has(depId));
        });
        // n3 depends on n1 which failed
        expect(layer1Blocked).toEqual(['n3']);
    });
});
