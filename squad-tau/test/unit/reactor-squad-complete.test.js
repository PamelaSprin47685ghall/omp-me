import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { createBaseState, setStatus, createSession } from '../helpers/state-builder.js';

function approveNode(st, id) {
    setStatus(st, id, 'idle');
    setStatus(st, id, STATUS.AUTHORING);
    createSession(st, id, 'authoring');
    setStatus(st, id, STATUS.CONFIRMING);
    createSession(st, id, 'confirming');
    setStatus(st, id, STATUS.REVIEWING);
    createSession(st, id, 'reviewing');
    setStatus(st, id, STATUS.APPROVED, { summary: `${id} done` });
}

describe('happy path', () => {
    test('all approved + outer review done emits SQUAD_COMPLETE', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');
        st.squad.outerReview = { status: 'approved', round: 1 };
        const e = reactState(st);
        expect(e.find((a) => a.type === Events.SQUAD_COMPLETE)).toBeDefined();
    });

    test('SQUAD_COMPLETE emitted only once', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');
        st.squad.outerReview = { status: 'approved', round: 1 };
        expect(reactState(st).some((a) => a.type === Events.SQUAD_COMPLETE)).toBe(true);
        st.squad.status = 'complete';
        expect(reactState(st).length).toBe(0);
    });
});

describe('outer review rejection', () => {
    test('rejected resets node to AUTHORING', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');
        st.squad.outerReview = { status: 'rejected', round: 1, feedback: 'rework' };
        const a = reactState(st).find(
            (e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING,
        );
        expect(a).toBeDefined();
        expect(a.payload.retryCount).toBe(1);
    });
});

describe('edge cases', () => {
    test('empty squad produces no events', () => {
        const st = createBaseState();
        st.squad.nodes = {};
        expect(reactState(st).length).toBe(0);
    });
});
