/**
 * DAG ordering invariants as algebraic snapshot tests.
 * Given event arrays, assert command arrays — no async, no mocks.
 *
 * Ported invariants from deprecated tests:
 *   - squad-flow.test.js (chain + diamond ordering)
 *   - dag-execute.test.js (blocked propagation)
 *   - squad-complete.test.js (partial failure completion)
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';

function log() {
    const a = [];
    let i = 0;
    return {
        append(e, p) {
            const o = { id: i++, event: e, payload: p };
            a.push(o);
            return o;
        },
        getSince(n = 0) {
            return a.slice(n);
        },
        all() {
            return a;
        },
    };
}

describe('chain dependency: n1 -> n2', () => {
    test('n2 does NOT start before n1 is approved', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
            ],
            originalTask: 'test',
        });

        // First react: both get idle
        let events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(2);
        for (const e of events) l.append(e.type, e.payload);

        // Second react: n1 -> AUTHORING, n2 stays idle (deps not met)
        events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(1);
        expect(events[0].payload.nodeId).toBe('n1');
        expect(events[0].payload.status).toBe(STATUS.AUTHORING);
        for (const e of events) l.append(e.type, e.payload);

        // Simulate n1 through to APPROVED
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', role: 'worker' });
        l.append(Events.SESSION_START, { sessionId: 'ss1', nodeId: 'n1', phase: 'worker' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.CONFIRMING });
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's2', nodeId: 'n1', role: 'reviewer' });
        l.append(Events.SESSION_START, { sessionId: 'ss2', nodeId: 'n1', phase: 'reviewer' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.REVIEWING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });

        // n1 approved → n2 should wake up + model release for n1
        events = reactState(project(l.getSince(0)));
        const n2Events = events.filter((e) => e.payload.nodeId === 'n2');
        expect(n2Events.length).toBeGreaterThan(0);
        expect(n2Events.some((e) => e.payload.status === STATUS.AUTHORING)).toBe(true);

        const releaseEvents = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        expect(releaseEvents.length).toBe(2);
    });

    test('n2 blocked when n1 fails', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
            ],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.FAILED });

        const events = reactState(project(l.getSince(0)));
        const blockEvent = events.find((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
        expect(blockEvent).toBeDefined();
        expect(blockEvent.payload.summary).toBe('Blocked by upstream');
    });

    test('reactor is idempotent for blocked nodes', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
            ],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.FAILED });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: STATUS.BLOCKED });

        let events = reactState(project(l.getSince(0)));
        let blockEvents = events.filter((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
        expect(blockEvents.length).toBe(0, 'no duplicate BLOCKED on first call');

        events = reactState(project(l.getSince(0)));
        blockEvents = events.filter((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
        expect(blockEvents.length).toBe(0, 'no duplicate BLOCKED on second call');
    });
});

describe('diamond dependency: A -> B,C -> D', () => {
    test('B and C start after A approved; D waits for both', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'A', task: 'alpha', review_criteria: [], depends_on: [] },
                { id: 'B', task: 'beta', review_criteria: [], depends_on: ['A'] },
                { id: 'C', task: 'gamma', review_criteria: [], depends_on: ['A'] },
                { id: 'D', task: 'delta', review_criteria: [], depends_on: ['B', 'C'] },
            ],
            originalTask: 'test',
        });

        // Step 1: idle transitions (all 4)
        let events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(4);
        for (const e of events) l.append(e.type, e.payload);

        // Step 2: A -> AUTHORING (only A has deps met)
        events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(1);
        expect(events[0].payload.nodeId).toBe('A');
        expect(events[0].payload.status).toBe(STATUS.AUTHORING);
        for (const e of events) l.append(e.type, e.payload);

        // Complete A through to APPROVED
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 'sA', nodeId: 'A', role: 'worker' });
        l.append(Events.SESSION_START, { sessionId: 'sA1', nodeId: 'A', phase: 'worker' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'A', status: STATUS.CONFIRMING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'A', status: STATUS.REVIEWING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'A', status: STATUS.APPROVED });
        l.append('model_pool:snapshot', { slots: [] });

        // After A approved: B and C should get events (idle -> authoring)
        events = reactState(project(l.getSince(0)));
        const bcEvents = events.filter((e) => ['B', 'C'].includes(e.payload.nodeId));
        expect(bcEvents.length).toBeGreaterThanOrEqual(2);
        const bHas = bcEvents.some((e) => e.payload.nodeId === 'B');
        const cHas = bcEvents.some((e) => e.payload.nodeId === 'C');
        expect(bHas).toBe(true);
        expect(cHas).toBe(true);

        // D should NOT start before B and C are done
        const dEvents = events.filter((e) => e.payload.nodeId === 'D');
        expect(dEvents.length).toBe(0);
    });
});

describe('partial failure completion', () => {
    test('mixed approved + failed emits SQUAD_COMPLETE without outer review', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: [] },
            ],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: STATUS.FAILED });

        const events = reactState(project(l.getSince(0)));
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();
        expect(complete.payload.results.length).toBe(2);
        expect(complete.payload.results.find((r) => r.nodeId === 'n1').status).toBe(STATUS.APPROVED);
        expect(complete.payload.results.find((r) => r.nodeId === 'n2').status).toBe(STATUS.FAILED);

        const orStart = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(orStart).toBeUndefined('outer review not triggered on partial failure');
    });

    test('SQUAD_COMPLETE not emitted while nodes still active', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 'task', review_criteria: [], depends_on: [] }],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });

        const events = reactState(project(l.getSince(0)));
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeUndefined('no complete while node is authoring');
    });
});
