import { describe, test, expect, spyOn } from 'bun:test';
import { STATUS } from '../../server/constants.js';

describe('executeDAG', () => {
    test('executes single node without dependencies', async () => {
        const nodes = [{ id: 'A', task: 'Task A' }];
        const ctx = { planId: 'test-plan' };
        const pi = {};
        const signal = { aborted: false };
        const events = [];
        const eventBus = { emit: (type, data) => events.push({ type, data }) };
        const modelPool = {};

        const concurrencyModule = await import('../../server/dag-concurrency.js');
        spyOn(concurrencyModule, 'executeLayer').mockResolvedValue([
            { nodeId: 'A', status: STATUS.COMPLETED, summary: 'Completed A', affectedFiles: [] },
        ]);

        const { executeDAG } = await import('../../server/dag-execute.js');
        const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

        expect(results.length).toBe(1);
        expect(results[0].nodeId).toBe('A');
        expect(results[0].status).toBe(STATUS.COMPLETED);
        expect(events.length).toBe(1);
        expect(events[0].type).toBe('squad:node_state');
        expect(events[0].data.nodeId).toBe('A');
    });
});

test('executes chain dependency A→B→C', async () => {
    const nodes = [
        { id: 'A', task: 'Task A' },
        { id: 'B', task: 'Task B', depends_on: ['A'] },
        { id: 'C', task: 'Task C', depends_on: ['B'] },
    ];
    const ctx = { planId: 'test-plan' };
    const pi = {};
    const signal = { aborted: false };
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    const modelPool = {};

    const executionOrder = [];
    const { executeLayer } = await import('../../server/dag-concurrency.js');
    const original = executeLayer;
    const mockExecuteLayer = async (layerNodes) => {
        executionOrder.push(layerNodes.map((n) => n.id));
        return layerNodes.map((node) => ({
            nodeId: node.id,
            status: STATUS.COMPLETED,
            summary: `Completed ${node.id}`,
            affectedFiles: [],
        }));
    };
    Object.assign(executeLayer, mockExecuteLayer);

    const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

    assert.equal(results.length, 3);
    assert.deepEqual(executionOrder, [['A'], ['B'], ['C']]);
    assert.equal(results[0].nodeId, 'A');
    assert.equal(results[1].nodeId, 'B');
    assert.equal(results[2].nodeId, 'C');

    Object.assign(executeLayer, original);
});

test('executes parallel nodes without dependencies', async () => {
    const nodes = [
        { id: 'A', task: 'Task A' },
        { id: 'B', task: 'Task B' },
        { id: 'C', task: 'Task C' },
    ];
    const ctx = { planId: 'test-plan' };
    const pi = {};
    const signal = { aborted: false };
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    const modelPool = {};

    const { executeLayer } = await import('../../server/dag-concurrency.js');
    const original = executeLayer;
    const mockExecuteLayer = async (layerNodes) => {
        assert.equal(layerNodes.length, 3);
        return layerNodes.map((node) => ({
            nodeId: node.id,
            status: STATUS.COMPLETED,
            summary: `Completed ${node.id}`,
            affectedFiles: [],
        }));
    };
    Object.assign(executeLayer, mockExecuteLayer);

    const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

    assert.equal(results.length, 3);
    const nodeIds = results.map((r) => r.nodeId).sort();
    assert.deepEqual(nodeIds, ['A', 'B', 'C']);

    Object.assign(executeLayer, original);
});

test('executes diamond dependency A→B,C→D', async () => {
    const nodes = [
        { id: 'A', task: 'Task A' },
        { id: 'B', task: 'Task B', depends_on: ['A'] },
        { id: 'C', task: 'Task C', depends_on: ['A'] },
        { id: 'D', task: 'Task D', depends_on: ['B', 'C'] },
    ];
    const ctx = { planId: 'test-plan' };
    const pi = {};
    const signal = { aborted: false };
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    const modelPool = {};

    const executionOrder = [];
    const { executeLayer } = await import('../../server/dag-concurrency.js');
    const original = executeLayer;
    const mockExecuteLayer = async (layerNodes) => {
        executionOrder.push(layerNodes.map((n) => n.id).sort());
        return layerNodes.map((node) => ({
            nodeId: node.id,
            status: STATUS.COMPLETED,
            summary: `Completed ${node.id}`,
            affectedFiles: [],
        }));
    };
    Object.assign(executeLayer, mockExecuteLayer);

    const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

    assert.equal(results.length, 4);
    assert.deepEqual(executionOrder, [['A'], ['B', 'C'], ['D']]);

    Object.assign(executeLayer, original);
});

test('blocks downstream when upstream fails', async () => {
    const nodes = [
        { id: 'A', task: 'Task A' },
        { id: 'B', task: 'Task B', depends_on: ['A'] },
        { id: 'C', task: 'Task C', depends_on: ['B'] },
    ];
    const ctx = { planId: 'test-plan' };
    const pi = {};
    const signal = { aborted: false };
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    const modelPool = {};

    const { executeLayer } = await import('../../server/dag-concurrency.js');
    const original = executeLayer;
    const mockExecuteLayer = async (layerNodes) => {
        return layerNodes.map((node) => ({
            nodeId: node.id,
            status: node.id === 'A' ? STATUS.FAILED : STATUS.COMPLETED,
            summary: node.id === 'A' ? 'Failed' : `Completed ${node.id}`,
            affectedFiles: [],
        }));
    };
    Object.assign(executeLayer, mockExecuteLayer);

    const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

    assert.equal(results.length, 3);
    assert.equal(results[0].nodeId, 'A');
    assert.equal(results[0].status, STATUS.FAILED);
    assert.equal(results[1].nodeId, 'B');
    assert.equal(results[1].status, STATUS.BLOCKED);
    assert.equal(results[2].nodeId, 'C');
    assert.equal(results[2].status, STATUS.BLOCKED);

    const blockedEvents = events.filter((e) => e.data.status === STATUS.BLOCKED);
    assert.equal(blockedEvents.length, 2);

    Object.assign(executeLayer, original);
});

test('marks all incomplete nodes as failed when signal aborts', async () => {
    const nodes = [
        { id: 'A', task: 'Task A' },
        { id: 'B', task: 'Task B', depends_on: ['A'] },
        { id: 'C', task: 'Task C', depends_on: ['B'] },
    ];
    const ctx = { planId: 'test-plan' };
    const pi = {};
    const signal = { aborted: false };
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    const modelPool = {};

    const { executeLayer } = await import('../../server/dag-concurrency.js');
    const original = executeLayer;
    const mockExecuteLayer = async (layerNodes) => {
        const results = layerNodes.map((node) => ({
            nodeId: node.id,
            status: STATUS.COMPLETED,
            summary: `Completed ${node.id}`,
            affectedFiles: [],
        }));
        signal.aborted = true;
        return results;
    };
    Object.assign(executeLayer, mockExecuteLayer);

    const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

    assert.equal(results.length, 3);
    assert.equal(results[0].status, STATUS.COMPLETED);
    assert.equal(results[1].status, STATUS.FAILED);
    assert.equal(results[1].summary, 'Aborted by signal');
    assert.equal(results[2].status, STATUS.FAILED);
    assert.equal(results[2].summary, 'Aborted by signal');

    Object.assign(executeLayer, original);
});

test('collects results with correct format', async () => {
    const nodes = [
        { id: 'A', task: 'Task A' },
        { id: 'B', task: 'Task B', depends_on: ['A'] },
    ];
    const ctx = { planId: 'test-plan' };
    const pi = {};
    const signal = { aborted: false };
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    const modelPool = {};

    const { executeLayer } = await import('../../server/dag-concurrency.js');
    const original = executeLayer;
    const mockExecuteLayer = async (layerNodes) => {
        return layerNodes.map((node) => ({
            nodeId: node.id,
            status: STATUS.COMPLETED,
            summary: `Summary for ${node.id}`,
            affectedFiles: [`file-${node.id}.js`],
        }));
    };
    Object.assign(executeLayer, mockExecuteLayer);

    const results = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

    assert.equal(results.length, 2);
    assert.equal(results[0].nodeId, 'A');
    assert.equal(results[0].status, STATUS.COMPLETED);
    assert.equal(results[0].summary, 'Summary for A');
    assert.deepEqual(results[0].affectedFiles, ['file-A.js']);
    assert.equal(results[1].nodeId, 'B');
    assert.deepEqual(results[1].affectedFiles, ['file-B.js']);

    Object.assign(executeLayer, original);
});

test('passes upstream results to executeLayer', async () => {
    const nodes = [
        { id: 'A', task: 'Task A' },
        { id: 'B', task: 'Task B', depends_on: ['A'] },
    ];
    const ctx = { planId: 'test-plan', customField: 'value' };
    const pi = {};
    const signal = { aborted: false };
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    const modelPool = {};

    let capturedCtx = null;
    const { executeLayer } = await import('../../server/dag-concurrency.js');
    const original = executeLayer;
    const mockExecuteLayer = async (layerNodes, layerCtx) => {
        if (layerNodes[0].id === 'B') {
            capturedCtx = layerCtx;
        }
        return layerNodes.map((node) => ({
            nodeId: node.id,
            status: STATUS.COMPLETED,
            summary: `Completed ${node.id}`,
            affectedFiles: [],
        }));
    };
    Object.assign(executeLayer, mockExecuteLayer);

    await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });

    assert.ok(capturedCtx);
    assert.equal(capturedCtx.customField, 'value');
    assert.ok(Array.isArray(capturedCtx.upstreamResults));
    assert.equal(capturedCtx.upstreamResults.length, 1);
    assert.equal(capturedCtx.upstreamResults[0].nodeId, 'A');

    Object.assign(executeLayer, original);
});
