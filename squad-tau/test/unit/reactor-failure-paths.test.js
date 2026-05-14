/**
 * Algebraic tests for node state machine failure and retry paths.
 * Pure algebraic: f(state) → Action[]. No event logs, no mocks.
 *
 * Covers: reviewer rejection/retry, blocked invariants, abort handling.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS, DEFAULTS } from '../../server/constants.js';
import { createBaseState, setStatus, createSession, giveReturn, acquireModel } from '../helpers/state-builder.js';

function reviewReadyState() {
    const st = createBaseState('n1');
    setStatus(st, 'n1', 'idle');
    setStatus(st, 'n1', STATUS.AUTHORING);
    acquireModel(st, 'n1', 'worker', 's1');
    createSession(st, 'n1', 'worker');
    setStatus(st, 'n1', STATUS.CONFIRMING);
    createSession(st, 'n1', 'worker_confirm');
    setStatus(st, 'n1', STATUS.REVIEWING);
    acquireModel(st, 'n1', 'reviewer', 's2');
    createSession(st, 'n1', 'reviewer');
    return st;
}

describe('reviewer rejection', () => {
    test('reviewer return error sends node back to AUTHORING with retryCount and feedback', () => {
        const st = reviewReadyState();
        giveReturn(st, 'n1-reviewer', 'error', 'needs more work');

        const events = reactState(st);
        const auth = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(auth).toBeDefined();
        expect(auth.payload.nodeId).toBe('n1');
        expect(auth.payload.retryCount).toBe(1);
        expect(auth.payload.feedback).toBe('needs more work');
    });

    test('retryCount increments on repeated rejections', () => {
        const st = reviewReadyState();
        giveReturn(st, 'n1-reviewer', 'error', 'fix 1');

        // First rejection → back to AUTHORING with retryCount=1
        let events = reactState(st);
        const auth1 = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(auth1).toBeDefined();
        expect(auth1.payload.retryCount).toBe(1);
        expect(auth1.payload.feedback).toBe('fix 1');

        // Apply retry: projection clears sessions, setup new cycle up to REVIEWING
        setStatus(st, 'n1', STATUS.AUTHORING, { retryCount: 1, feedback: 'fix 1' });
        // Projection also clears session refs on retry
        st.squad.nodes[0].activeSessionId = null;
        st.squad.nodes[0].activePhase = null;
        st.squad.nodes[0].sessionStatus = 'none';
        delete st.sessions['n1-worker'];
        delete st.sessions['n1-worker_confirm'];
        delete st.sessions['n1-reviewer'];

        acquireModel(st, 'n1', 'worker', 's1-new');
        createSession(st, 'n1', 'worker');
        giveReturn(st, 'n1-worker', 'ok', 'done again');
        setStatus(st, 'n1', STATUS.CONFIRMING);
        createSession(st, 'n1', 'worker_confirm');
        giveReturn(st, 'n1-worker_confirm', 'ok', 'confirmed again');
        setStatus(st, 'n1', STATUS.REVIEWING);
        acquireModel(st, 'n1', 'reviewer', 's2-new');
        createSession(st, 'n1', 'reviewer');

        // Second rejection in the NEW session
        giveReturn(st, 'n1-reviewer', 'error', 'fix 2');

        events = reactState(st);
        const auth2 = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(auth2).toBeDefined();
        expect(auth2.payload.retryCount).toBe(2);
        expect(auth2.payload.feedback).toBe('fix 2');
    });

    test('reviewer approval transitions node to APPROVED', () => {
        const st = reviewReadyState();
        giveReturn(st, 'n1-reviewer', 'ok', 'good work');

        const events = reactState(st);
        const approve = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.APPROVED);
        expect(approve).toBeDefined();
        expect(approve.payload.nodeId).toBe('n1');
        expect(approve.payload.summary).toBe('good work');
    });
});

describe('blocked node invariants', () => {
    test('blocked node stays blocked across repeated reactor calls', () => {
        const st = createBaseState(
            { id: 'n1', task: 'first', depends_on: [] },
            { id: 'n2', task: 'second', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.FAILED);
        setStatus(st, 'n2', STATUS.BLOCKED);

        for (let i = 0; i < 3; i++) {
            const events = reactState(st);
            const blocks = events.filter((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
            expect(blocks.length).toBe(0, `no duplicate BLOCKED on call ${i + 1}`);
        }
    });

    test('blocked node does not prevent other terminal node processing', () => {
        const st = createBaseState(
            { id: 'n1', task: 'first', depends_on: [] },
            { id: 'n2', task: 'second', depends_on: ['n1'] },
            { id: 'n3', task: 'third', depends_on: [] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        setStatus(st, 'n3', 'idle');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n1', STATUS.FAILED);
        setStatus(st, 'n2', STATUS.BLOCKED);
        setStatus(st, 'n3', STATUS.AUTHORING);
        setStatus(st, 'n3', STATUS.APPROVED, { summary: 'n3 done' });

        const events = reactState(st);
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();
        expect(complete.payload.results.map((r) => r.nodeId)).toEqual(expect.arrayContaining(['n1', 'n2', 'n3']));
        expect(complete.payload.results.find((r) => r.nodeId === 'n2').status).toBe(STATUS.BLOCKED);
    });
});

describe('abort handling', () => {
    test('SQUAD_ABORT causes react to return empty array immediately', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', 'idle');
        st.squad.status = 'aborted';

        expect(reactState(st).length).toBe(0);
    });

    test('aborted squad ignores subsequent node processing', () => {
        const st = createBaseState(
            { id: 'n1', task: 'first', depends_on: [] },
            { id: 'n2', task: 'second', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'idle');
        setStatus(st, 'n2', 'idle');
        st.squad.status = 'aborted';

        expect(reactState(st).length).toBe(0);
    });

    test('abort does not affect already-terminated squad', () => {
        const st = createBaseState('n1');
        st.squad.status = 'complete';

        expect(reactState(st).length).toBe(0);

        st.squad.status = 'aborted';
        expect(reactState(st).length).toBe(0);
    });
});
