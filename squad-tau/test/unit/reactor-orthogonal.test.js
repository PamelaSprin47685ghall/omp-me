import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS, DEFAULTS } from '../../server/constants.js';
import { sessionIdFor } from '../../shared/events.js';
import { createBaseState, setStatus, createSession, giveReturn } from '../helpers/state-builder.js';

describe('max retries boundary', () => {
    test('after MAX_RETRIES consecutive reviewer rejections, node goes to FAILED', () => {
        const st = createBaseState('n1');
        const rc = DEFAULTS.MAX_RETRIES - 1;
        setStatus(st, 'n1', STATUS.REVIEWING, { retryCount: rc });
        const sid = createSession(st, 'n1', 'reviewing');
        expect(sid).toBe(sessionIdFor('n1', 'reviewing', rc));
        giveReturn(st, sid, 'error', 'fix final');
        const actions = reactState(st);
        const fail = actions.filter((a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.FAILED);
        expect(fail.length).toBe(1);
        expect(fail[0].payload.nodeId).toBe('n1');
        const auth = actions.filter((a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.AUTHORING);
        expect(auth.length).toBe(0);
    });

    test('at MAX_RETRIES-1 retries, rejection sends back to AUTHORING', () => {
        const st = createBaseState('n1');
        const rc = DEFAULTS.MAX_RETRIES - 2;
        setStatus(st, 'n1', STATUS.REVIEWING, { retryCount: rc });
        const sid = createSession(st, 'n1', 'reviewing');
        giveReturn(st, sid, 'error', 'still needs work');
        const actions = reactState(st);
        const auth = actions.find((a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.AUTHORING);
        expect(auth).toBeDefined();
        expect(auth.payload.retryCount).toBe(DEFAULTS.MAX_RETRIES - 1);
        expect(auth.payload.feedback).toBe('still needs work');
    });
});

describe('concurrency gating', () => {
    test('emits SESSION_CREATING when within limit', () => {
        const st = createBaseState('n1', 'n2');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n2', STATUS.AUTHORING);
        const events = reactState(st);
        const cmds = events.filter((e) => e.type === Events.SESSION_CREATING);
        expect(cmds.length).toBe(2);
        expect(cmds[0].payload.sessionId).toBe(sessionIdFor('n1', 'authoring', 0));
        expect(cmds[1].payload.sessionId).toBe(sessionIdFor('n2', 'authoring', 0));
    });

    test('does NOT emit SESSION_CREATING at limit', () => {
        const st = createBaseState('n1', 'n2', 'n3', 'n4');
        st.modelPool.maxWorkers = 3;
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n2', STATUS.AUTHORING);
        setStatus(st, 'n3', STATUS.AUTHORING);
        setStatus(st, 'n4', STATUS.AUTHORING);
        createSession(st, 'n1', 'authoring');
        createSession(st, 'n2', 'authoring');
        createSession(st, 'n3', 'authoring');
        const events = reactState(st);
        expect(events.filter((e) => e.type === Events.SESSION_CREATING && e.payload.nodeId === 'n4').length).toBe(0);
    });
});
