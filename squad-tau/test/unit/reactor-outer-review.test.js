import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { createBaseState, setStatus, createSession, giveReturn } from '../helpers/state-builder.js';
import { sessionIdFor } from '../../shared/events.js';

function approvedState() {
    const st = createBaseState('n1');
    setStatus(st, 'n1', 'idle');
    setStatus(st, 'n1', 'authoring');
    createSession(st, 'n1', 'authoring');
    setStatus(st, 'n1', 'confirming');
    createSession(st, 'n1', 'confirming');
    setStatus(st, 'n1', 'reviewing');
    createSession(st, 'n1', 'reviewing');
    setStatus(st, 'n1', 'approved');
    return st;
}

describe('happy path', () => {
    test('emits SQUAD_OUTER_REVIEW_START', () => {
        const st = approvedState();
        expect(reactState(st).find((e) => e.type === 'squad:outer_review_start')).toBeDefined();
    });

    test('full lifecycle to SQUAD_COMPLETE', () => {
        const st = approvedState();
        let e = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };

        e = reactState(st);
        const createEv = e.find((a) => a.type === 'session:creating');
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
        expect(e.find((a) => a.type === 'squad:outer_review_done')).toBeDefined();
        expect(e.find((a) => a.type === 'session:end')).toBeDefined();

        st.squad.outerReview.status = 'approved';
        e = reactState(st);
        expect(e.find((a) => a.type === 'squad:complete')).toBeDefined();
    });
});

describe('rejection', () => {
    test('failed emits FAILED event', () => {
        const st = approvedState();
        let e = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };
        e = reactState(st);
        const createEv = e.find((a) => a.type === 'session:creating');
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
        expect(e.find((a) => a.type === 'squad:outer_review_failed')).toBeDefined();
    });
});
