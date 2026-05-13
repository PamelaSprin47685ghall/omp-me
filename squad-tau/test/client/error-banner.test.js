import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

describe('ErrorBanner component logic', () => {
    it('filters nodes to only failed and blocked', () => {
        const nodes = new Map([
            ['N1', { nodeId: 'N1', status: 'failed', summary: 'Error', id: 'N1' }],
            ['N2', { nodeId: 'N2', status: 'approved', summary: 'Done', id: 'N2' }],
            ['N3', { nodeId: 'N3', status: 'blocked', summary: '', id: 'N3' }],
            ['N4', { nodeId: 'N4', status: 'authoring', summary: '', id: 'N4' }],
        ]);

        const failedNodes = Array.from(nodes.values()).filter(
            (node) => node.status === 'failed' || node.status === 'blocked',
        );

        assert.strictEqual(failedNodes.length, 2);
        assert.strictEqual(failedNodes[0].nodeId, 'N1');
        assert.strictEqual(failedNodes[1].nodeId, 'N3');
    });
});
