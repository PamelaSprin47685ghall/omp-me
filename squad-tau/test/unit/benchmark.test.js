import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';

const WARMUP = 1000;
const MEASURE = 10000;

function measure(label, fn, iterations = MEASURE) {
    // warmup
    for (let i = 0; i < WARMUP; i++) fn();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const elapsed = performance.now() - start;
    const opsPerSec = Math.round((iterations / elapsed) * 1000);
    console.log(
        `  ${label}: ${opsPerSec.toLocaleString()} ops/s (${iterations} iterations in ${elapsed.toFixed(1)}ms)`,
    );
    return opsPerSec;
}

describe('Performance Benchmarks', () => {
    it('EventBus publish throughput', async () => {
        const { EventBus } = await import('../../server/event-bus.js');
        const bus = new EventBus();
        const received = [];
        bus.on('test:bench', (p) => received.push(p));

        const ops = measure('EventBus.emit + listener', () => {
            bus.emit('test', 'bench', { i: 1 });
        });
        assert.ok(ops > 10000, `EventBus should handle >10k emit/s (got ${ops})`);
    });

    it('EventBus wildcard publish throughput', async () => {
        const { EventBus } = await import('../../server/event-bus.js');
        const bus = new EventBus();
        const received = [];
        bus.on('test:*', (p, type) => received.push({ p, type }));

        const ops = measure('EventBus wildcard emit', () => {
            bus.emit('test', 'bench', { i: 1 });
        });
        assert.ok(ops > 5000, `Wildcard EventBus should handle >5k emit/s (got ${ops})`);
    });

    it('ModelPool acquire/release throughput', async () => {
        const { ModelPool } = await import('../../server/model-pool.js');
        const pool = new ModelPool([
            { provider: 'p1', modelId: 'm1', role: 'worker' },
            { provider: 'p1', modelId: 'm2', role: 'reviewer' },
        ]);

        const ops = measure(
            'ModelPool acquire+release',
            async () => {
                const w = await pool.acquire('worker');
                pool.release(w);
                const r = await pool.acquire('reviewer');
                pool.release(r);
            },
            1000,
        );
        assert.ok(ops > 100, `ModelPool should handle >100 acq/rel per second (got ${ops})`);
    });

    it('DAG topological sort throughput', async () => {
        const { topologicalSort } = await import('../../server/dag-sort.js');

        const nodes = Array.from({ length: 50 }, (_, i) => ({
            id: `n${i}`,
            depends_on: i > 0 ? [`n${i - 1}`] : [],
        }));

        const ops = measure('topologicalSort (50 nodes)', () => {
            topologicalSort(nodes);
        });
        assert.ok(ops > 1000, `DAG sort should handle >1k sorts/s for 50 nodes (got ${ops})`);
    });

    it('validatePlan throughput', async () => {
        const { validatePlan } = await import('../../server/validate-plan.js');

        const plan = {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'task 1', review_criteria: 'quality' },
                { id: 'n2', task: 'task 2', review_criteria: 'quality', depends_on: ['n1'] },
            ],
        };

        const ops = measure('validatePlan', () => {
            validatePlan(plan);
        });
        assert.ok(ops > 50000, `validatePlan should handle >50k validations/s (got ${ops})`);
    });
});
