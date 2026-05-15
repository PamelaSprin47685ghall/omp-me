/**
 * Outer review as a regular node — using the rule-based reactor.
 * In L mode, __or__ node is auto-injected by squad:init.
 * When rejected, R5 emits squad:phase_changed (Architect Awakening)
 * instead of resetting workers — macro-level topology freeze.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { buildState, setStatus } from '../helpers/state-builder.js';

describe('outer review as regular node', () => {
    test('__or__ transitions to reviewing when deps met', () => {
        const st = buildState({
            mode: 'L',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
        });
        setStatus(st, 'n1', 'approved');
        // __or__ starts undefined → R2 fires (undefined + depsMet → reviewing)
        const e = reactState(st);
        const rev = e.find((a) => a.payload.nodeId === '__or__' && a.payload.status === 'reviewing');
        expect(rev).toBeDefined();
    });

    test('__or__ approved emits squad:complete', () => {
        const st = buildState({
            mode: 'L',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
        });
        setStatus(st, 'n1', 'approved');
        setStatus(st, '__or__', 'approved');
        const e = reactState(st);
        expect(e.find((a) => a.type === 'squad:complete')).toBeDefined();
    });

    test('squad:complete only once', () => {
        const st = buildState({
            mode: 'L',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
        });
        setStatus(st, 'n1', 'approved');
        setStatus(st, '__or__', 'approved');
        expect(reactState(st).some((a) => a.type === 'squad:complete')).toBe(true);
        st.squad.status = 'complete';
        expect(reactState(st).length).toBe(0);
    });
});

describe('rejection → architect awakening', () => {
    test('__or__ rejected emits squad:phase_changed, not worker reset', () => {
        const st = buildState({
            mode: 'L',
            nodes: [{ id: 'n1', task: 'a', review_criteria: [] }],
        });
        setStatus(st, 'n1', 'approved');
        setStatus(st, '__or__', 'rejected', { round: 1, feedback: 'rework' });
        const e = reactState(st);

        // R5 should emit squad:phase_changed (not reset workers)
        const phaseChanged = e.find((a) => a.type === 'squad:phase_changed');
        expect(phaseChanged).toBeDefined();
        expect(phaseChanged.payload.phase).toBe('revising');
        expect(phaseChanged.payload.feedback).toBe('rework');

        // No worker should be reset to authoring
        const workerReset = e.find((a) => a.type === 'squad:node_state' && a.payload.status === 'authoring');
        expect(workerReset).toBeUndefined();

        // __or__ should NOT be reset to undefined
        const orUndef = e.find((a) => a.payload.nodeId === '__or__' && a.payload.status === undefined);
        expect(orUndef).toBeUndefined();
    });

    test('squad:phase_changed only fires once (guarded by phase check)', () => {
        const st = buildState({
            mode: 'L',
            nodes: [{ id: 'n1', task: 'a', review_criteria: [] }],
        });
        setStatus(st, 'n1', 'approved');
        setStatus(st, '__or__', 'rejected', { round: 1, feedback: 'rework 1' });

        // First call: R5 fires
        const e1 = reactState(st);
        expect(e1.some((a) => a.type === 'squad:phase_changed')).toBe(true);

        // Simulate projections applied: set phase to 'revising'
        st.squad.phase = 'revising';

        // Second call: guard prevents re-trigger
        const e2 = reactState(st);
        expect(e2.some((a) => a.type === 'squad:phase_changed')).toBe(false);
        expect(e2.length).toBe(0);
    });
});
