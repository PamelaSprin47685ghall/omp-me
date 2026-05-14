/**
 * DAG ordering invariants as algebraic snapshot tests.
 * Pure algebraic: f(state) → Action[]. No event logs, no mocks.
 *
 * Covers: chain dependency, diamond dependency, partial failure completion.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { createBaseState, setStatus, createSession, acquireModel } from '../helpers/state-builder.js';

describe('chain dependency: n1 -> n2', () => {
    test('n2 does NOT start before n1 is approved', () => {
        const st = createBaseState(
            { id: 'n1', task: 'first', depends_on: [] },
            { id: 'n2', task: 'second', depends_on: ['n1'] },
        );

        // n1 idle, n2 idle → reactor emits n1->AUTHORING (n2 deps not met)
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        let events = reactState(st);
        expect(events.length).toBe(1);
        expect(events[0].payload.nodeId).toBe('n1');
        expect(events[0].payload.status).toBe(STATUS.AUTHORING);

        // Complete n1 through approval
        setStatus(st, 'n1', STATUS.AUTHORING);
        acquireModel(st, 'n1', 'worker', 's1');
        createSession(st, 'n1', 'worker');

        setStatus(st, 'n1', STATUS.CONFIRMING);
        createSession(st, 'n1', 'worker_confirm');

        setStatus(st, 'n1', STATUS.REVIEWING);
        acquireModel(st, 'n1', 'reviewer', 's2');
        createSession(st, 'n1', 'reviewer');

        setStatus(st, 'n1', STATUS.APPROVED);

        // n1 approved → n2 should wake up + model release for n1
        events = reactState(st);
        const n2Events = events.filter((e) => e.payload.nodeId === 'n2');
        expect(n2Events.length).toBeGreaterThan(0);
        expect(n2Events.some((e) => e.payload.status === STATUS.AUTHORING)).toBe(true);

        const releases = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        expect(releases.length).toBe(2);
    });

    test('n2 blocked when n1 fails', () => {
        const st = createBaseState(
            { id: 'n1', task: 'first', depends_on: [] },
            { id: 'n2', task: 'second', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.FAILED);

        const events = reactState(st);
        const block = events.find((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
        expect(block).toBeDefined();
        expect(block.payload.summary).toBe('Blocked by upstream');
    });

    test('reactor is idempotent for blocked nodes', () => {
        const st = createBaseState(
            { id: 'n1', task: 'first', depends_on: [] },
            { id: 'n2', task: 'second', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.FAILED);
        setStatus(st, 'n2', STATUS.BLOCKED);

        let events = reactState(st);
        let blocks = events.filter((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
        expect(blocks.length).toBe(0, 'no duplicate BLOCKED on first call');

        events = reactState(st);
        blocks = events.filter((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
        expect(blocks.length).toBe(0, 'no duplicate BLOCKED on second call');
    });
});

describe('diamond dependency: A -> B,C -> D', () => {
    test('B and C start after A approved; D waits for both', () => {
        const st = createBaseState(
            { id: 'A', task: 'alpha', depends_on: [] },
            { id: 'B', task: 'beta', depends_on: ['A'] },
            { id: 'C', task: 'gamma', depends_on: ['A'] },
            { id: 'D', task: 'delta', depends_on: ['B', 'C'] },
        );

        // Step 1: idle transitions (all 4)
        for (const id of ['A', 'B', 'C', 'D']) setStatus(st, id, 'idle');
        let events = reactState(st);
        expect(events.length).toBe(1);
        expect(events[0].payload.nodeId).toBe('A');
        expect(events[0].payload.status).toBe(STATUS.AUTHORING);

        // Complete A through to APPROVED
        setStatus(st, 'A', STATUS.AUTHORING);
        acquireModel(st, 'A', 'worker', 'sA');
        createSession(st, 'A', 'worker');
        setStatus(st, 'A', STATUS.CONFIRMING);
        createSession(st, 'A', 'worker_confirm');
        setStatus(st, 'A', STATUS.REVIEWING);
        setStatus(st, 'A', STATUS.APPROVED);

        // After A approved: B and C should get authoring, D should not start
        events = reactState(st);
        const bc = events.filter((e) => ['B', 'C'].includes(e.payload.nodeId));
        expect(bc.length).toBeGreaterThanOrEqual(2);
        expect(bc.some((e) => e.payload.nodeId === 'B')).toBe(true);
        expect(bc.some((e) => e.payload.nodeId === 'C')).toBe(true);

        const d = events.filter((e) => e.payload.nodeId === 'D');
        expect(d.length).toBe(0);
    });
});

describe('partial failure completion', () => {
    test('mixed approved + failed emits SQUAD_COMPLETE without outer review', () => {
        const st = createBaseState('n1', 'n2');
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.APPROVED, { summary: 'n1 done' });
        setStatus(st, 'n2', STATUS.AUTHORING);
        setStatus(st, 'n2', STATUS.FAILED);

        const events = reactState(st);
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();
        expect(complete.payload.results.length).toBe(2);
        expect(complete.payload.results.find((r) => r.nodeId === 'n1').status).toBe(STATUS.APPROVED);
        expect(complete.payload.results.find((r) => r.nodeId === 'n2').status).toBe(STATUS.FAILED);

        const orStart = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(orStart).toBeUndefined('outer review not triggered on partial failure');
    });

    test('SQUAD_COMPLETE not emitted while nodes still active', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);

        const events = reactState(st);
        expect(events.find((e) => e.type === Events.SQUAD_COMPLETE)).toBeUndefined(
            'no complete while node is authoring',
        );
    });
});
