/**
 * Orthogonal unit tests for individual reactor behaviors.
 * Pure algebraic: f(state) → Action[]. No event logs, no mocks.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS, DEFAULTS } from '../../server/constants.js';
import { applyEvent } from '../../shared/projections.js';
import {
    createBaseState,
    setStatus,
    createSession,
    giveReturn,
    acquireModel,
    addSlot,
    setSlots,
} from '../helpers/state-builder.js';

describe('reactor model release rule', () => {
    test('releases models when node is APPROVED', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', STATUS.AUTHORING);
        acquireModel(st, 'n1', 'worker', 's1');
        createSession(st, 'n1', 'worker');
        setStatus(st, 'n1', STATUS.CONFIRMING);
        createSession(st, 'n1', 'worker_confirm');
        setStatus(st, 'n1', STATUS.REVIEWING);
        acquireModel(st, 'n1', 'reviewer', 's2');
        createSession(st, 'n1', 'reviewer');
        setStatus(st, 'n1', STATUS.APPROVED);
        setSlots(st, [
            { slotId: 's1', role: 'worker', provider: 'test', modelId: 'w1' },
            { slotId: 's2', role: 'reviewer', provider: 'test', modelId: 'r1' },
        ]);

        const events = reactState(st);
        const releases = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        expect(releases.length).toBe(2);
        expect(releases.some((e) => e.payload.slotId === 's1')).toBe(true);
        expect(releases.some((e) => e.payload.slotId === 's2')).toBe(true);
    });

    test('does NOT generate duplicate MODEL_POOL_RELEASE for same slot', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', STATUS.AUTHORING);
        acquireModel(st, 'n1', 'worker', 's1');
        createSession(st, 'n1', 'worker');
        setStatus(st, 'n1', STATUS.APPROVED);
        setSlots(st, [{ slotId: 's1', role: 'worker', provider: 'test', modelId: 'w1' }]);

        // First call emits release
        const events1 = reactState(st);
        expect(events1.filter((e) => e.type === Events.MODEL_POOL_RELEASE).length).toBe(1);

        // Apply the release to state
        const releaseAction = events1.find((e) => e.type === Events.MODEL_POOL_RELEASE);
        applyEvent(st, releaseAction.type, releaseAction.payload);

        // Second call: no duplicate
        const events2 = reactState(st);
        expect(events2.filter((e) => e.type === Events.MODEL_POOL_RELEASE).length).toBe(0);
    });
});

describe('max retries boundary', () => {
    test('after DEFAULTS.MAX_RETRIES (5) consecutive reviewer rejections, node goes to FAILED', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', STATUS.REVIEWING, { retryCount: DEFAULTS.MAX_RETRIES - 1 });
        const sid = createSession(st, 'n1', 'reviewer');

        for (let i = 1; i <= DEFAULTS.MAX_RETRIES - 1; i++) {
            giveReturn(st, sid, 'error', `fix ${i}`);
        }
        giveReturn(st, sid, 'error', 'fix 5');

        const actions = reactState(st);
        const fail = actions.filter((a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.FAILED);
        expect(fail.length).toBe(1);
        expect(fail[0].payload.nodeId).toBe('n1');

        const auth = actions.filter((a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.AUTHORING);
        expect(auth.length).toBe(0, 'No AUTHORING after MAX_RETRIES exceeded');
    });

    test('at MAX_RETRIES-1 retries, rejection sends back to AUTHORING', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', STATUS.REVIEWING, { retryCount: DEFAULTS.MAX_RETRIES - 2 });
        const sid = createSession(st, 'n1', 'reviewer');
        giveReturn(st, sid, 'error', 'still needs work');

        const actions = reactState(st);
        const auth = actions.filter((a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.AUTHORING);
        expect(auth.length).toBe(1);
        expect(auth[0].payload.retryCount).toBe(DEFAULTS.MAX_RETRIES - 1);
        expect(auth[0].payload.feedback).toBe('still needs work');
    });
});

describe('empty model pool fallback', () => {
    test('node with empty pool skips MODEL_POOL_ACQUIRE, emits SESSION_CREATING directly', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', STATUS.AUTHORING);

        const events = reactState(st);
        expect(events.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE).length).toBe(0);
        const createCmds = events.filter((e) => e.type === Events.SESSION_CREATING);
        expect(createCmds.length).toBe(1);
        expect(createCmds[0].payload.nodeId).toBe('n1');
        expect(createCmds[0].payload.phase).toBe('worker');
    });

    test('outer review skips model acquisition when no reviewer slots configured', () => {
        const st = createBaseState('n1');
        setStatus(st, 'n1', STATUS.APPROVED);

        const events = reactState(st);
        const orStart = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(orStart).toBeDefined();
        expect(orStart.payload.round).toBe(1);

        // Apply the outer review start and re-run
        st.squad.outerReview = { status: 'pending', round: 1 };
        const events2 = reactState(st);
        expect(events2.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE).length).toBe(0);
        expect(events2.filter((e) => e.type === Events.SESSION_CREATING).length).toBe(1);
    });
});

describe('concurrent slot allocation (slot stealing)', () => {
    test('3 nodes waiting, 1 model released → only 1 MODEL_POOL_ACQUIRE', () => {
        const st = createBaseState('n1', 'n2', 'n3');
        setStatus(st, 'n1', STATUS.AUTHORING);
        setStatus(st, 'n2', STATUS.AUTHORING);
        setStatus(st, 'n3', STATUS.AUTHORING);
        acquireModel(st, 'n1', 'worker', 's1');
        setSlots(st, [{ slotId: 's1', role: 'worker', provider: 'test', modelId: 'w1' }]);

        // All slots busy → no new acquire
        const events1 = reactState(st);
        expect(events1.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE).length).toBe(0);

        // Release s1 and re-run
        applyEvent(st, Events.MODEL_POOL_RELEASE, { slotId: 's1' });
        const events2 = reactState(st);
        expect(events2.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE).length).toBe(1);
    });
});
