import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { STATUS } from '../../server/constants.js';
import { createBaseState, setStatus, createSession } from '../helpers/state-builder.js';

function approveNode(st, id) {
    setStatus(st, id, STATUS.AUTHORING);
    createSession(st, id, 'authoring');
    setStatus(st, id, STATUS.CONFIRMING);
    createSession(st, id, 'confirming');
    setStatus(st, id, STATUS.REVIEWING);
    createSession(st, id, 'reviewing');
    setStatus(st, id, STATUS.APPROVED);
}

describe('chain dependency: n1 -> n2', () => {
    test('n2 does NOT start before n1 approved', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        let e = reactState(st);
        expect(e.length).toBe(1);
        expect(e[0].payload.nodeId).toBe('n1');
        expect(e[0].payload.status).toBe(STATUS.AUTHORING);
        approveNode(st, 'n1');
        e = reactState(st);
        expect(e.some((a) => a.payload.nodeId === 'n2' && a.payload.status === STATUS.AUTHORING)).toBe(true);
    });

    test('n2 blocked when n1 fails', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.FAILED);
        const block = reactState(st).find((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
        expect(block).toBeDefined();
    });

    test('reactor idempotent for blocked nodes', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.FAILED);
        setStatus(st, 'n2', STATUS.BLOCKED);
        for (let i = 0; i < 3; i++) {
            expect(
                reactState(st).filter((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED).length,
            ).toBe(0);
        }
    });
});

describe('diamond: A -> B,C -> D', () => {
    test('B,C start after A done; D waits', () => {
        const st = createBaseState(
            { id: 'A', task: 'a', depends_on: [] },
            { id: 'B', task: 'b', depends_on: ['A'] },
            { id: 'C', task: 'c', depends_on: ['A'] },
            { id: 'D', task: 'd', depends_on: ['B', 'C'] },
        );
        for (const id of ['A', 'B', 'C', 'D']) setStatus(st, id, 'idle');
        expect(reactState(st)[0].payload.nodeId).toBe('A');
        approveNode(st, 'A');
        const e = reactState(st);
        expect(e.some((a) => a.payload.nodeId === 'B')).toBe(true);
        expect(e.some((a) => a.payload.nodeId === 'C')).toBe(true);
        expect(e.filter((a) => a.payload.nodeId === 'D').length).toBe(0);
    });
});

describe('partial failure completion', () => {
    test('mixed approved + failed emits SQUAD_COMPLETE', () => {
        const st = createBaseState('n1', 'n2');
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.APPROVED, { summary: 'ok' });
        setStatus(st, 'n2', STATUS.AUTHORING);
        setStatus(st, 'n2', STATUS.FAILED);
        const e = reactState(st);
        expect(e.find((a) => a.type === 'squad:complete')).toBeDefined();
        expect(e.find((a) => a.type === 'squad:outer_review_start')).toBeUndefined();
    });
});
