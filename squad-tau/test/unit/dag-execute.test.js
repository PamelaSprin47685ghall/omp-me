import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { STATUS } from '../../server/constants.js';

const mockExecuteLayer = mock(async (nodes) => {
    return nodes.map((n) => ({
        nodeId: n.id,
        status: STATUS.APPROVED,
        summary: 'ok',
        affectedFiles: [],
    }));
});

mock.module('../../server/dag-concurrency.js', () => ({
    executeLayer: mockExecuteLayer,
}));

// Import after mocking
import { executeDAG } from '../../server/dag-execute.js';

describe('executeDAG', () => {
    let eventBus;
    let signal;
    let controller;

    beforeEach(() => {
        eventBus = new EventEmitter();
        controller = new AbortController();
        signal = controller.signal;
        mockExecuteLayer.mockClear();
    });

    it('single layer executes all nodes', async () => {
        const nodes = [{ id: 'n1', task: 't1', review_criteria: 'c1', depends_on: [] }];
        const results = await executeDAG({ nodes, signal, eventBus });

        expect(results).toHaveLength(1);
        expect(results[0].nodeId).toBe('n1');
        expect(results[0].status).toBe(STATUS.APPROVED);
        expect(mockExecuteLayer).toHaveBeenCalledTimes(1);
    });

    it('aborted layer marks remaining as failed', async () => {
        controller.abort();
        const nodes = [
            { id: 'n1', task: 't1', review_criteria: 'c1', depends_on: [] },
            { id: 'n2', task: 't2', review_criteria: 'c2', depends_on: [] },
            { id: 'n3', task: 't3', review_criteria: 'c3', depends_on: [] },
        ];

        const results = await executeDAG({ nodes, signal, eventBus });

        expect(results).toHaveLength(3);
        results.forEach((r) => {
            expect(r.status).toBe(STATUS.FAILED);
            expect(r.summary).toBe('Aborted by signal');
        });
        expect(mockExecuteLayer).not.toHaveBeenCalled();
    });

    it('blocked node propagates downstream', async () => {
        const nodes = [
            { id: 'n1', task: 't1', review_criteria: 'c1', depends_on: [] },
            { id: 'n2', task: 't2', review_criteria: 'c2', depends_on: ['n1'] },
        ];

        mockExecuteLayer.mockImplementationOnce(async (nodes) => {
            return [{ nodeId: 'n1', status: STATUS.FAILED, summary: 'err', affectedFiles: [] }];
        });

        const results = await executeDAG({ nodes, signal, eventBus });

        expect(results).toHaveLength(2);
        const n1 = results.find((r) => r.nodeId === 'n1');
        const n2 = results.find((r) => r.nodeId === 'n2');

        expect(n1.status).toBe(STATUS.FAILED);
        expect(n2.status).toBe(STATUS.BLOCKED);
        expect(n2.summary).toBe('Blocked by failed upstream dependency');
        expect(mockExecuteLayer).toHaveBeenCalledTimes(1);
    });

    it('multiple layers execute in order', async () => {
        const nodes = [
            { id: 'n1', task: 't1', review_criteria: 'c1', depends_on: [] },
            { id: 'n2', task: 't2', review_criteria: 'c2', depends_on: ['n1'] },
            { id: 'n3', task: 't3', review_criteria: 'c3', depends_on: ['n2'] },
        ];

        const callOrder = [];
        mockExecuteLayer.mockImplementation(async (nodes) => {
            callOrder.push(nodes.map((n) => n.id));
            return nodes.map((n) => ({
                nodeId: n.id,
                status: STATUS.APPROVED,
                summary: 'ok',
                affectedFiles: [],
            }));
        });

        const results = await executeDAG({ nodes, signal, eventBus });

        expect(results).toHaveLength(3);
        expect(callOrder).toEqual([['n1'], ['n2'], ['n3']]);
        expect(results.every((r) => r.status === STATUS.APPROVED)).toBe(true);
    });
});
