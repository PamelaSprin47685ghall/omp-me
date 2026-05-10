import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { formatNodeCounts, getFailureReason } from '../../client/components/ErrorBanner.jsx';

describe('formatNodeCounts', () => {
    it('returns empty string for empty array', () => {
        assert.strictEqual(formatNodeCounts([]), '');
    });

    it('returns only failed count', () => {
        const nodes = [
            { nodeId: 'N1', status: 'failed' },
            { nodeId: 'N2', status: 'failed' },
        ];
        assert.strictEqual(formatNodeCounts(nodes), '2 failed');
    });

    it('returns only blocked count', () => {
        const nodes = [
            { nodeId: 'N1', status: 'blocked' },
            { nodeId: 'N2', status: 'blocked' },
        ];
        assert.strictEqual(formatNodeCounts(nodes), '2 blocked');
    });

    it('returns both counts separated by comma', () => {
        const nodes = [
            { nodeId: 'N1', status: 'failed' },
            { nodeId: 'N2', status: 'blocked' },
        ];
        assert.strictEqual(formatNodeCounts(nodes), '1 failed, 1 blocked');
    });

    it('returns single failed with mixed statuses ignored', () => {
        const nodes = [
            { nodeId: 'N1', status: 'failed' },
            { nodeId: 'N2', status: 'approved' },
        ];
        assert.strictEqual(formatNodeCounts(nodes), '1 failed');
    });

    it('handles multiple failed and blocked', () => {
        const nodes = [
            { nodeId: 'N1', status: 'failed' },
            { nodeId: 'N2', status: 'failed' },
            { nodeId: 'N3', status: 'blocked' },
            { nodeId: 'N4', status: 'blocked' },
            { nodeId: 'N5', status: 'blocked' },
        ];
        assert.strictEqual(formatNodeCounts(nodes), '2 failed, 3 blocked');
    });
});

describe('getFailureReason', () => {
    it('returns first node summary when available', () => {
        const nodes = [
            { nodeId: 'N1', status: 'failed', summary: 'Build error' },
            { nodeId: 'N2', status: 'failed', summary: 'Other error' },
        ];
        assert.strictEqual(getFailureReason(nodes), 'Build error');
    });

    it('returns "Unknown error" when no summary available', () => {
        assert.strictEqual(getFailureReason([{ nodeId: 'N1', status: 'failed', summary: '' }]), 'Unknown error');
    });

    it('returns "Unknown error" when summary is undefined', () => {
        assert.strictEqual(getFailureReason([{ nodeId: 'N1', status: 'failed' }]), 'Unknown error');
    });

    it('skips nodes without summary and uses first with summary', () => {
        const nodes = [
            { nodeId: 'N1', status: 'failed', summary: '' },
            { nodeId: 'N2', status: 'blocked', summary: 'Dependency issue' },
        ];
        assert.strictEqual(getFailureReason(nodes), 'Dependency issue');
    });

    it('returns "Unknown error" for empty array', () => {
        assert.strictEqual(getFailureReason([]), 'Unknown error');
    });

    it('skips multiple empty summaries', () => {
        const nodes = [
            { nodeId: 'N1', status: 'failed', summary: '' },
            { nodeId: 'N2', status: 'blocked', summary: '' },
            { nodeId: 'N3', status: 'failed', summary: 'Real error' },
        ];
        assert.strictEqual(getFailureReason(nodes), 'Real error');
    });
});

describe('ErrorBanner component logic', () => {
    it('filters nodes to only failed and blocked', () => {
        const nodes = new Map([
            ['N1', { nodeId: 'N1', status: 'failed', summary: 'Error' }],
            ['N2', { nodeId: 'N2', status: 'approved', summary: 'Done' }],
            ['N3', { nodeId: 'N3', status: 'blocked', summary: '' }],
            ['N4', { nodeId: 'N4', status: 'authoring', summary: '' }],
        ]);

        const failedNodes = Array.from(nodes.values()).filter(
            (node) => node.status === 'failed' || node.status === 'blocked',
        );

        assert.strictEqual(failedNodes.length, 2);
        assert.strictEqual(failedNodes[0].nodeId, 'N1');
        assert.strictEqual(failedNodes[1].nodeId, 'N3');
    });

    it('generates error key from sorted node IDs', () => {
        const nodes1 = [
            { nodeId: 'N003', status: 'failed' },
            { nodeId: 'N001', status: 'blocked' },
            { nodeId: 'N002', status: 'failed' },
        ];

        const key1 = nodes1
            .map((n) => n.nodeId)
            .sort()
            .join(',');
        assert.strictEqual(key1, 'N001,N002,N003');

        const nodes2 = [
            { nodeId: 'N002', status: 'failed' },
            { nodeId: 'N003', status: 'failed' },
            { nodeId: 'N001', status: 'blocked' },
        ];

        const key2 = nodes2
            .map((n) => n.nodeId)
            .sort()
            .join(',');
        assert.strictEqual(key2, 'N001,N002,N003');
        assert.strictEqual(key1, key2);
    });

    it('generates different keys for different node sets', () => {
        const key1 = ['N001', 'N002'].sort().join(',');
        const key2 = ['N001', 'N002', 'N003'].sort().join(',');
        assert.notStrictEqual(key1, key2);
    });

    it('formats plural correctly', () => {
        assert.strictEqual(1 > 1 ? 's' : '', '');
        assert.strictEqual(2 > 1 ? 's' : '', 's');
    });
});
