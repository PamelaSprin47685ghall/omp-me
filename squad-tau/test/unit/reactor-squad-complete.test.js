import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { createBaseState, buildState, setStatus } from '../helpers/state-builder.js';

describe('happy path', () => {
    test('M mode single node approved emits SQUAD_COMPLETE', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', 'approved', { summary: 'n1 done' });
        const e = reactState(st);
        expect(e.find((a) => a.type === 'squad:complete')).toBeDefined();
    });

    test('SQUAD_COMPLETE emitted only once', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', 'approved', { summary: 'n1 done' });
        expect(reactState(st).some((a) => a.type === 'squad:complete')).toBe(true);
        st.squad.status = 'complete';
        expect(reactState(st).length).toBe(0);
    });
});

describe('outer review rejection', () => {
    test('rejected emits phase_changed, not worker reset', () => {
        const st = buildState({
            mode: 'L',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
        });
        setStatus(st, 'n1', 'approved', { summary: 'n1 done' });
        setStatus(st, '__or__', 'rejected', { round: 1, feedback: 'rework' });
        const e = reactState(st);

        // Should emit squad:phase_changed, not reset nodes
        const phaseChanged = e.find((a) => a.type === 'squad:phase_changed');
        expect(phaseChanged).toBeDefined();
        expect(phaseChanged.payload.phase).toBe('revising');

        const workerReset = e.find((a) => a.type === 'squad:node_state' && a.payload.status === 'authoring');
        expect(workerReset).toBeUndefined();
    });
});

describe('edge cases', () => {
    test('empty squad produces no events', () => {
        const st = createBaseState();
        st.squad.nodes = {};
        expect(reactState(st).length).toBe(0);
    });
});
