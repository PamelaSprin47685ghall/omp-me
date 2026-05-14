import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { createBaseState, setStatus, createSession, giveReturn } from '../helpers/state-builder.js';
import { sessionIdFor } from '../../shared/events.js';

function approvedState() {
    const st = createBaseState('n1');
    setStatus(st, 'n1', 'idle');
    setStatus(st, 'n1', STATUS.AUTHORING);
    createSession(st, 'n1', 'authoring');
    setStatus(st, 'n1', STATUS.CONFIRMING);
    createSession(st, 'n1', 'confirming');
    setStatus(st, 'n1', STATUS.REVIEWING);
    createSession(st, 'n1', 'reviewing');
    setStatus(st, 'n1', STATUS.APPROVED);
    return st;
}

describe('happy path', () => {
    test('emits SQUAD_OUTER_REVIEW_START', () => {
        const st = approvedState();
        expect(reactState(st).find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START)).toBeDefined();
    });

    test('full lifecycle to SQUAD_COMPLETE', () => {
        const st = approvedState();
        let e = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };

        e = reactState(st);
        const createEv = e.find((a) => a.type === Events.SESSION_CREATING);
        expect(createEv).toBeDefined();
        expect(createEv.payload.sessionId).toBe(sessionIdFor('or', 'outer_review', 1));

        const sid = createEv.payload.sessionId;
        st.sessions[sid] = {
            sessionId: sid,
            nodeId: null,
            phase: 'outer_review',
            role: 'outer_review',
            status: 'active',
            messages: [],
        };
        st.squad.outerReview.lastPrompted = true;

        giveReturn(st, sid, 'ok', 'all good');
        e = reactState(st);
        expect(e.find((a) => a.type === Events.SQUAD_OUTER_REVIEW_DONE)).toBeDefined();
        expect(e.find((a) => a.type === Events.SESSION_END)).toBeDefined();

        st.squad.outerReview.status = 'approved';
        e = reactState(st);
        expect(e.find((a) => a.type === Events.SQUAD_COMPLETE)).toBeDefined();
    });
});

describe('rejection', () => {
    test('failed emits FAILED event', () => {
        const st = approvedState();
        let e = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };
        e = reactState(st);
        const createEv = e.find((a) => a.type === Events.SESSION_CREATING);
        const sid = createEv?.payload?.sessionId || sessionIdFor('or', 'outer_review', 1);
        st.sessions[sid] = {
            sessionId: sid,
            nodeId: null,
            phase: 'outer_review',
            role: 'outer_review',
            status: 'active',
            messages: [],
        };
        st.squad.outerReview.lastPrompted = true;
        giveReturn(st, sid, 'error', 'bad');
        e = reactState(st);
        expect(e.find((a) => a.type === Events.SQUAD_OUTER_REVIEW_FAILED)).toBeDefined();
    });
});
