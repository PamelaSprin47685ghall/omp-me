import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { applyEvent } from '../../shared/projections.js';
import { sessionIdFor } from '../../shared/events.js';
import { createBaseState, setStatus, createSession, giveReturn } from '../helpers/state-builder.js';

describe('max retries boundary', () => {
    test('after MAX_RETRIES consecutive reviewer rejections, node goes to FAILED', () => {
        const st = createBaseState('n1');
        const rc = 5 - 1;
        setStatus(st, 'n1', 'reviewing', { retryCount: rc });
        const sid = createSession(st, 'n1', 'reviewing');
        expect(sid).toBe(sessionIdFor('n1', 'reviewing', rc));
        giveReturn(st, sid, 'error', 'fix final');
        const actions = reactState(st);
        const fail = actions.filter((a) => a.type === 'squad:node_state' && a.payload.status === 'failed');
        expect(fail.length).toBe(1);
        expect(fail[0].payload.nodeId).toBe('n1');
        const auth = actions.filter((a) => a.type === 'squad:node_state' && a.payload.status === 'authoring');
        expect(auth.length).toBe(0);
    });

    test('at MAX_RETRIES-1 retries, rejection sends back to AUTHORING', () => {
        const st = createBaseState('n1');
        const rc = 5 - 2;
        setStatus(st, 'n1', 'reviewing', { retryCount: rc });
        const sid = createSession(st, 'n1', 'reviewing');
        giveReturn(st, sid, 'error', 'still needs work');
        const actions = reactState(st);
        const auth = actions.find((a) => a.type === 'squad:node_state' && a.payload.status === 'authoring');
        expect(auth).toBeDefined();
        expect(auth.payload.retryCount).toBe(5 - 1);
        expect(auth.payload.feedback).toBe('still needs work');
    });
});

describe('concurrency gating', () => {
    test('emits SESSION_CREATING when within limit', () => {
        const st = createBaseState('n1', 'n2');
        setStatus(st, 'n1', 'authoring');
        setStatus(st, 'n2', 'authoring');
        const events = reactState(st);
        const cmds = events.filter((e) => e.type === 'session:creating');
        expect(cmds.length).toBe(2);
        expect(cmds[0].payload.sessionId).toBe(sessionIdFor('n1', 'authoring', 0));
        expect(cmds[1].payload.sessionId).toBe(sessionIdFor('n2', 'authoring', 0));
    });

    test('does NOT emit SESSION_CREATING at limit', () => {
        const st = createBaseState('n1', 'n2', 'n3', 'n4');
        applyEvent(st, 'model_pool:snapshot', { maxWorkers: 3 });
        setStatus(st, 'n1', 'authoring');
        setStatus(st, 'n2', 'authoring');
        setStatus(st, 'n3', 'authoring');
        setStatus(st, 'n4', 'authoring');
        createSession(st, 'n1', 'authoring');
        createSession(st, 'n2', 'authoring');
        createSession(st, 'n3', 'authoring');
        const events = reactState(st);
        expect(events.filter((e) => e.type === 'session:creating' && e.payload.nodeId === 'n4').length).toBe(0);
    });
});
