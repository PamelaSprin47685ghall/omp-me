import { describe, test, expect, mock, spyOn } from 'bun:test';
import { STATUS } from '../../server/constants.js';

describe('runNode', () => {
    test('happy path: worker → confirm → reviewer approve', async () => {
        const events = [];
        const eventBus = {
            emit: (type, data) => events.push({ type, data }),
        };

        const workerSlot = { id: 'worker-1' };
        const reviewerSlot = { id: 'reviewer-1' };

        const modelPool = {
            acquire: mock(async (role) => (role === 'worker' ? workerSlot : reviewerSlot)),
            release: mock(() => {}),
        };

        const node = { id: 'n1', task: 'Fix bug', review_criteria: 'No regressions' };
        const upstreamResults = [];
        const ctx = { cwd: '/tmp' };
        const pi = {};
        const signal = { aborted: false };

        const workerModule = await import('../../server/run-worker.js');
        const confirmModule = await import('../../server/run-confirm.js');
        const reviewerModule = await import('../../server/run-reviewer.js');
        const tamperModule = await import('../../server/tamper-detection.js');

        spyOn(workerModule, 'runWorker').mockResolvedValue({
            sessionId: 'sess-1',
            summary: 'Fixed bug',
            affectedFiles: ['foo.js'],
        });

        spyOn(confirmModule, 'runConfirmSession').mockResolvedValue({ action: 'confirm' });
        spyOn(reviewerModule, 'runReviewer').mockResolvedValue({ approved: true });
        spyOn(tamperModule, 'captureFileSnapshots').mockResolvedValue({});
        spyOn(tamperModule, 'filesChanged').mockResolvedValue([]);

        const { runNode } = await import('../../server/run-node.js');
        const result = await runNode({ node, upstreamResults, ctx, pi, signal, eventBus, modelPool });

        expect(result.status).toBe(STATUS.APPROVED);
        expect(result.summary).toBe('Fixed bug');
        expect(result.affectedFiles).toEqual(['foo.js']);

        expect(events.some((e) => e.data.status === STATUS.AUTHORING)).toBe(true);
        expect(events.some((e) => e.data.status === STATUS.CONFIRMING)).toBe(true);
        expect(events.some((e) => e.data.status === STATUS.REVIEWING)).toBe(true);
        expect(events.some((e) => e.data.status === STATUS.APPROVED)).toBe(true);

        expect(modelPool.release).toHaveBeenCalledTimes(2);
    });

    test('reviewer rejects → retry loop', async () => {
        const eventBus = { emit: mock(() => {}) };
        const modelPool = {
            acquire: mock(async () => ({ id: 'slot-1' })),
            release: mock(() => {}),
        };

        const node = { id: 'n2', task: 'Add feature' };
        let workerCallCount = 0;
        let reviewCallCount = 0;

        const workerModule = await import('../../server/run-worker.js');
        const confirmModule = await import('../../server/run-confirm.js');
        const reviewerModule = await import('../../server/run-reviewer.js');
        const tamperModule = await import('../../server/tamper-detection.js');

        spyOn(workerModule, 'runWorker').mockImplementation(async () => {
            workerCallCount++;
            return { sessionId: 'sess-2', summary: `Attempt ${workerCallCount}`, affectedFiles: [] };
        });

        spyOn(confirmModule, 'runConfirmSession').mockResolvedValue({ action: 'confirm' });

        spyOn(reviewerModule, 'runReviewer').mockImplementation(async () => {
            reviewCallCount++;
            if (reviewCallCount === 1) {
                return { approved: false, feedback: 'Missing tests' };
            }
            return { approved: true };
        });

        spyOn(tamperModule, 'captureFileSnapshots').mockResolvedValue({});
        spyOn(tamperModule, 'filesChanged').mockResolvedValue([]);

        const { runNode } = await import('../../server/run-node.js');
        const result = await runNode({
            node,
            upstreamResults: [],
            ctx: { cwd: '/tmp' },
            pi: {},
            signal: { aborted: false },
            eventBus,
            modelPool,
        });

        expect(result.status).toBe(STATUS.APPROVED);
        expect(workerCallCount).toBe(2);
        expect(reviewCallCount).toBe(2);
    });

    test('releases slots on abort', async () => {
        const eventBus = { emit: mock(() => {}) };
        const workerSlot = { id: 'worker-1' };
        const modelPool = {
            acquire: mock(async () => workerSlot),
            release: mock(() => {}),
        };

        const signal = { aborted: false };

        const workerModule = await import('../../server/run-worker.js');
        spyOn(workerModule, 'runWorker').mockImplementation(async () => {
            signal.aborted = true;
            throw new Error('Aborted');
        });

        const { runNode } = await import('../../server/run-node.js');

        await expect(
            runNode({
                node: { id: 'n3', task: 'Task' },
                upstreamResults: [],
                ctx: { cwd: '/tmp' },
                pi: {},
                signal,
                eventBus,
                modelPool,
            }),
        ).rejects.toThrow('Aborted');

        expect(modelPool.release).toHaveBeenCalledWith(workerSlot);
    });
});
