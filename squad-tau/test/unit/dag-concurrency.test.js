import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeLayer } from '../../server/dag-concurrency.js';

test('executes single node', async () => {
    const nodes = [{ id: 'n1', task: 'task1' }];
    const ctx = { concurrency: 5 };
    const pi = {};
    const signal = { aborted: false };
    const emitCalls = [];
    const eventBus = { emit: (...args) => emitCalls.push(args) };

    const mockModelPool = {
        runNode: async () => ({
            status: 'approved',
            summary: 'done',
            affectedFiles: ['file1.js'],
        }),
    };

    const results = await executeLayer(nodes, ctx, pi, signal, eventBus, mockModelPool);

    assert.equal(results.length, 1);
    assert.equal(results[0].nodeId, 'n1');
    assert.equal(results[0].status, 'approved');
    assert.equal(results[0].summary, 'done');
    assert.deepEqual(results[0].affectedFiles, ['file1.js']);
});

test('executes multiple nodes in parallel', async () => {
    const nodes = [
        { id: 'n1', task: 'task1' },
        { id: 'n2', task: 'task2' },
        { id: 'n3', task: 'task3' },
    ];
    const ctx = { concurrency: 2 };
    const pi = {};
    const signal = { aborted: false };
    const emitCalls = [];
    const eventBus = { emit: (...args) => emitCalls.push(args) };

    const executionOrder = [];
    const mockModelPool = {
        runNode: async ({ node }) => {
            executionOrder.push(node.id);
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { status: 'approved', summary: `${node.id} done`, affectedFiles: [] };
        },
    };

    const results = await executeLayer(nodes, ctx, pi, signal, eventBus, mockModelPool);

    assert.equal(results.length, 3);
    assert.equal(executionOrder.length, 3);
});

test('respects concurrency limit', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, task: `task${i}` }));
    const ctx = { concurrency: 3 };
    const pi = {};
    const signal = { aborted: false };
    const emitCalls = [];
    const eventBus = { emit: (...args) => emitCalls.push(args) };

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const mockModelPool = {
        runNode: async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await new Promise((resolve) => setTimeout(resolve, 20));
            currentConcurrent--;
            return { status: 'approved', summary: 'done', affectedFiles: [] };
        },
    };

    await executeLayer(nodes, ctx, pi, signal, eventBus, mockModelPool);

    assert.ok(maxConcurrent <= 3, `maxConcurrent was ${maxConcurrent}, expected <= 3`);
});

test('handles node failure without blocking others', async () => {
    const nodes = [
        { id: 'n1', task: 'task1' },
        { id: 'n2', task: 'task2' },
        { id: 'n3', task: 'task3' },
    ];
    const ctx = { concurrency: 5 };
    const pi = {};
    const signal = { aborted: false };
    const emitCalls = [];
    const eventBus = { emit: (...args) => emitCalls.push(args) };

    const mockModelPool = {
        runNode: async ({ node }) => {
            if (node.id === 'n2') {
                throw new Error('n2 failed');
            }
            return { status: 'approved', summary: `${node.id} done`, affectedFiles: [] };
        },
    };

    const results = await executeLayer(nodes, ctx, pi, signal, eventBus, mockModelPool);

    assert.equal(results.length, 3);
    const n1Result = results.find((r) => r.nodeId === 'n1');
    const n2Result = results.find((r) => r.nodeId === 'n2');
    const n3Result = results.find((r) => r.nodeId === 'n3');

    assert.equal(n1Result.status, 'approved');
    assert.equal(n2Result.status, 'failed');
    assert.equal(n2Result.summary, 'n2 failed');
    assert.equal(n3Result.status, 'approved');
});

test('propagates abort signal', async () => {
    const nodes = [
        { id: 'n1', task: 'task1' },
        { id: 'n2', task: 'task2' },
        { id: 'n3', task: 'task3' },
    ];
    const ctx = { concurrency: 5 };
    const pi = {};
    const signal = { aborted: false };
    const emitCalls = [];
    const eventBus = { emit: (...args) => emitCalls.push(args) };

    const mockModelPool = {
        runNode: async ({ node }) => {
            if (node.id === 'n1') {
                signal.aborted = true;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { status: 'approved', summary: `${node.id} done`, affectedFiles: [] };
        },
    };

    const results = await executeLayer(nodes, ctx, pi, signal, eventBus, mockModelPool);

    const abortedNodes = results.filter((r) => r.status === 'failed' && r.summary === 'Aborted');
    assert.ok(abortedNodes.length > 0, 'Expected some nodes to be aborted');
});

test('emits events for node start and end', async () => {
    const nodes = [{ id: 'n1', task: 'task1' }];
    const ctx = { concurrency: 5 };
    const pi = {};
    const signal = { aborted: false };
    const emitCalls = [];
    const eventBus = { emit: (...args) => emitCalls.push(args) };

    const mockModelPool = {
        runNode: async () => ({
            status: 'approved',
            summary: 'done',
            affectedFiles: [],
        }),
    };

    await executeLayer(nodes, ctx, pi, signal, eventBus, mockModelPool);

    const startCall = emitCalls.find((call) => call[1] === 'node_start');
    const endCall = emitCalls.find((call) => call[1] === 'node_end');

    assert.ok(startCall, 'Expected node_start event');
    assert.ok(endCall, 'Expected node_end event');
    assert.equal(startCall[2].nodeId, 'n1');
    assert.equal(endCall[2].nodeId, 'n1');
});
