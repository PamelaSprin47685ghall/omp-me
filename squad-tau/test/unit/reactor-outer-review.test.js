/**
 * Outer review as a regular node — using the rule-based reactor.
 * In L mode, __or__ node is auto-injected by squad:init.
 * It behaves like any other node; when rejected, R5 resets workers.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { buildState, setStatus } from '../helpers/state-builder.js';
import { sessionIdFor } from '../../shared/events.js';

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

describe('rejection cycle', () => {
    test('__or__ rejected resets workers to authoring', () => {
        const st = buildState({
            mode: 'L',
            nodes: [{ id: 'n1', task: 'a', review_criteria: [] }],
        });
        setStatus(st, 'n1', 'approved');
        setStatus(st, '__or__', 'rejected', { round: 1, feedback: 'rework' });
        const e = reactState(st);
        // R5 should reset n1 to authoring and __or__ to idle
        const n1Reset = e.find((a) => a.payload.nodeId === 'n1' && a.payload.status === 'authoring');
        expect(n1Reset).toBeDefined();
        expect(n1Reset.payload.epoch).toBe(1);
        const orUndef = e.find((a) => a.payload.nodeId === '__or__' && a.payload.status === undefined);
        expect(orUndef).toBeDefined();
    });
});
