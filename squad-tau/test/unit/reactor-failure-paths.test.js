import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { createBaseState, setStatus, createSession, giveReturn } from '../helpers/state-builder.js';
import { sessionIdFor } from '../../shared/events.js';

function reviewReady() {
    const st = createBaseState('n1');
    setStatus(st, 'n1', 'idle');
    setStatus(st, 'n1', 'authoring');
    createSession(st, 'n1', 'authoring');
    setStatus(st, 'n1', 'confirming');
    createSession(st, 'n1', 'confirming');
    setStatus(st, 'n1', 'reviewing');
    createSession(st, 'n1', 'reviewing');
    return st;
}

describe('reviewer rejection', () => {
    test('error sends back to AUTHORING with retryCount', () => {
        const st = reviewReady();
        giveReturn(st, sessionIdFor('n1', 'reviewing', 0), 'error', 'needs work');
        const a = reactState(st).find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === 'authoring');
        expect(a).toBeDefined();
        expect(a.payload.retryCount).toBe(1);
        expect(a.payload.feedback).toBe('needs work');
    });

    test('retryCount increments on repeat rejections', () => {
        const st = reviewReady();
        giveReturn(st, sessionIdFor('n1', 'reviewing', 0), 'error', 'fix 1');
        let a = reactState(st).find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === 'authoring');
        expect(a.payload.retryCount).toBe(1);

        setStatus(st, 'n1', 'authoring', { retryCount: 1, feedback: 'fix 1' });
        createSession(st, 'n1', 'authoring');
        setStatus(st, 'n1', 'confirming');
        createSession(st, 'n1', 'confirming');
        setStatus(st, 'n1', 'reviewing');
        createSession(st, 'n1', 'reviewing');
        giveReturn(st, sessionIdFor('n1', 'reviewing', 1), 'error', 'fix 2');

        a = reactState(st).find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === 'authoring');
        expect(a.payload.retryCount).toBe(2);
    });

    test('approval transitions to APPROVED', () => {
        const st = reviewReady();
        giveReturn(st, sessionIdFor('n1', 'reviewing', 0), 'ok', 'good');
        const a = reactState(st).find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === 'approved');
        expect(a).toBeDefined();
        expect(a.payload.summary).toBe('good');
    });
});

describe('blocked invariants', () => {
    test('idempotent across calls', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        setStatus(st, 'n1', 'authoring');
        setStatus(st, 'n1', 'failed');
        setStatus(st, 'n2', 'blocked');
        for (let i = 0; i < 3; i++) {
            expect(
                reactState(st).filter((e) => e.payload.nodeId === 'n2' && e.payload.status === 'blocked').length,
            ).toBe(0);
        }
    });
});

describe('abort handling', () => {
    test('aborted squad returns empty', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', 'idle');
        st.squad.status = 'aborted';
        expect(reactState(st).length).toBe(0);
    });
});
