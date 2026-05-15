import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { createBaseState, setStatus } from '../helpers/state-builder.js';

function approveNode(st, id) {
    setStatus(st, id, 'approved');
}

describe('chain dependency: n1 -> n2', () => {
    test('n2 does NOT start before n1 approved', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        // n1 starts at 'authoring' (initial wavefront), n2 is undefined
        expect(st.squad.nodes.n1.status).toBe('authoring');
        expect(st.squad.nodes.n2.status).toBe(undefined);

        // n1 already authoring → reactor produces session:creating for it
        // n2 undefined + deps not met (n1 not approved) → no action for n2
        const initial = reactState(st);
        expect(initial.length).toBe(1);
        expect(initial[0].type).toBe('session:creating');
        expect(initial[0].payload.nodeId).toBe('n1');

        // After n1 approved, n2 cascade should fire
        approveNode(st, 'n1');
        const e = reactState(st);
        expect(e.some((a) => a.payload.nodeId === 'n2' && a.payload.status === 'authoring')).toBe(true);
    });

    test('n2 blocked when n1 fails', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'failed');
        const block = reactState(st).find((e) => e.payload.nodeId === 'n2' && e.payload.status === 'blocked');
        expect(block).toBeDefined();
    });

    test('reactor idempotent for blocked nodes', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'failed');
        setStatus(st, 'n2', 'blocked');
        for (let i = 0; i < 3; i++) {
            expect(
                reactState(st).filter((e) => e.payload.nodeId === 'n2' && e.payload.status === 'blocked').length,
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
        // A starts at 'authoring' (initial wavefront)
        expect(st.squad.nodes.A.status).toBe('authoring');
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
        setStatus(st, 'n1', 'approved', { summary: 'ok' });
        setStatus(st, 'n2', 'failed');
        const e = reactState(st);
        expect(e.find((a) => a.type === 'squad:complete')).toBeDefined();
    });
});
