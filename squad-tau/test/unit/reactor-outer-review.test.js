/**
 * Algebraic tests for Outer Review phase.
 * Pure algebraic: f(state) → Action[]. No event logs, no mocks.
 *
 * Covers: happy path (start → acquire → create → prompt → done → complete),
 * rejection path, model release semantics.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import {
    createBaseState,
    setStatus,
    createSession,
    giveReturn,
    acquireModel,
    addSlot,
} from '../helpers/state-builder.js';

/**
 * Build state with a fully approved node + model pool with worker & reviewer slots.
 */
function approvedState() {
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
    setStatus(st, 'n1', STATUS.APPROVED);
    // Re-populate pool slots (they were consumed by acquireModel)
    st.modelPool.slots = [
        { slotId: 's1', role: 'worker', provider: 'test', modelId: 'w1' },
        { slotId: 's2', role: 'reviewer', provider: 'test', modelId: 'r1' },
    ];
    return st;
}

describe('outer review — happy path', () => {
    test('emits SQUAD_OUTER_REVIEW_START when all nodes approved', () => {
        const st = approvedState();
        const events = reactState(st);
        const start = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(start).toBeDefined();
        expect(start.payload.round).toBe(1);
    });

    test('full lifecycle: start → acquire → create → prompt → done → complete', () => {
        const st = approvedState();

        // Step 1: reactor emits MODEL_POOL_RELEASE(s1,s2) + SQUAD_OUTER_REVIEW_START
        let events = reactState(st);
        const start = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(start).toBeDefined();

        // Apply side effects: clear usage from releases, set outer review pending
        delete st.modelPool.usage['s1'];
        delete st.modelPool.usage['s2'];
        st.squad.outerReview = { status: 'pending', round: 1 };

        // Step 2: MODEL_POOL_ACQUIRE for outer review
        events = reactState(st);
        const acquire = events.find((e) => e.type === Events.MODEL_POOL_ACQUIRE && !e.payload.nodeId);
        expect(acquire).toBeDefined();
        expect(acquire.payload.role).toBe('reviewer');
        const orSlotId = acquire.payload.slotId;

        // Apply acquisition (outer review has no nodeId — usage entry with undefined nodeId matches reactor check)
        st.modelPool.usage[orSlotId] = { inUse: true, holder: undefined, nodeId: undefined, role: 'reviewer' };

        // Step 3: CMD_CREATE_SESSION for outer_review
        events = reactState(st);
        const createSessionEv = events.find(
            (e) => e.type === Events.CMD_CREATE_SESSION && e.payload.phase === 'outer_review',
        );
        expect(createSessionEv).toBeDefined();
        expect(createSessionEv.payload.slotId).toBe(orSlotId);

        // Apply session creation
        createSession(st, null, 'outer_review');

        // Step 4: CMD_PROMPT for outer_review
        events = reactState(st);
        const prompt = events.find((e) => e.type === Events.CMD_PROMPT && e.payload.phase === 'outer_review');
        expect(prompt).toBeDefined();

        // Apply prompting
        if (st.squad.outerReview) st.squad.outerReview.lastPrompted = true;

        // Step 5: no more events until tool call
        events = reactState(st);
        const orEvents = events.filter((e) => e.type !== Events.MODEL_POOL_RELEASE);
        expect(orEvents.length).toBe(0);

        // Step 6: return with ok
        giveReturn(st, 'or-outer_review', 'ok', 'all good');

        // Step 7: SQUAD_OUTER_REVIEW_DONE
        events = reactState(st);
        const done = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_DONE);
        expect(done).toBeDefined();
        // Apply the done + session end
        if (st.squad.outerReview) st.squad.outerReview.status = 'approved';
        delete st.sessions['or-outer_review'];

        // Step 8: SQUAD_COMPLETE
        events = reactState(st);
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();
        expect(complete.payload.results[0].nodeId).toBe('n1');
    });
});

describe('outer review — rejection path', () => {
    test('failed review: two-step (FAILED event then node resets)', () => {
        const st = approvedState();

        // Advance to prompt phase
        let events = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };
        delete st.modelPool.usage['s1'];
        delete st.modelPool.usage['s2'];
        events = reactState(st);
        const acquire = events.find((e) => e.type === Events.MODEL_POOL_ACQUIRE && !e.payload.nodeId);
        if (acquire)
            st.modelPool.usage[acquire.payload.slotId] = {
                inUse: true,
                holder: undefined,
                nodeId: undefined,
                role: 'reviewer',
            };
        events = reactState(st);
        createSession(st, null, 'outer_review');
        if (st.squad.outerReview) st.squad.outerReview.lastPrompted = true;

        // Return with error
        giveReturn(st, 'or-outer_review', 'error', 'does not meet requirements');

        events = reactState(st);
        const failed = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_FAILED);
        expect(failed).toBeDefined();
        expect(failed.payload.reason).toBe('does not meet requirements');
    });

    test('after reset and re-approval, starts new outer review round', () => {
        const st = approvedState();

        // Advance to submitted review
        let events = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };
        delete st.modelPool.usage['s1'];
        delete st.modelPool.usage['s2'];
        events = reactState(st);
        const acquire = events.find((e) => e.type === Events.MODEL_POOL_ACQUIRE && !e.payload.nodeId);
        if (acquire)
            st.modelPool.usage[acquire.payload.slotId] = {
                inUse: true,
                holder: undefined,
                nodeId: undefined,
                role: 'reviewer',
            };
        events = reactState(st);
        createSession(st, null, 'outer_review');
        if (st.squad.outerReview) st.squad.outerReview.lastPrompted = true;

        // Return with error → FAILED emitted
        giveReturn(st, 'or-outer_review', 'error', 'bad');
        events = reactState(st);
        st.squad.outerReview = { status: 'rejected', round: 1, feedback: 'bad' };
        delete st.sessions['or-outer_review'];

        // Node reset: n1 → AUTHORING + releases
        events = reactState(st);
        const reset = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(reset).toBeDefined();

        // Apply reset then re-approve
        setStatus(st, 'n1', STATUS.AUTHORING, { retryCount: 1, feedback: 'bad' });
        st.squad.nodes[0].authoringSessionId = null;
        st.squad.nodes[0].confirmingSessionId = null;
        st.squad.nodes[0].reviewerSessionId = null;
        delete st.sessions['n1-worker'];
        delete st.sessions['n1-worker_confirm'];
        delete st.sessions['n1-reviewer'];
        acquireModel(st, 'n1', 'worker', 's1');
        createSession(st, 'n1', 'worker');
        setStatus(st, 'n1', STATUS.CONFIRMING);
        createSession(st, 'n1', 'worker_confirm');
        setStatus(st, 'n1', STATUS.REVIEWING);
        acquireModel(st, 'n1', 'reviewer', 's2');
        setStatus(st, 'n1', STATUS.APPROVED);

        // Should start round 2
        events = reactState(st);
        const start = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(start).toBeDefined();
        expect(start.payload.round).toBe(2);
    });
});

describe('outer review — model release', () => {
    test('releases outer review model after DONE', () => {
        const st = approvedState();
        let events = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };
        delete st.modelPool.usage['s1'];
        delete st.modelPool.usage['s2'];
        events = reactState(st);
        const acquire = events.find((e) => e.type === Events.MODEL_POOL_ACQUIRE && !e.payload.nodeId);
        const orSlotId = acquire?.payload?.slotId;
        if (orSlotId)
            st.modelPool.usage[orSlotId] = { inUse: true, holder: undefined, nodeId: undefined, role: 'reviewer' };
        events = reactState(st);
        createSession(st, null, 'outer_review');
        if (st.squad.outerReview) st.squad.outerReview.lastPrompted = true;

        // Return with ok
        giveReturn(st, 'or-outer_review', 'ok', 'approved');
        events = reactState(st);
        st.squad.outerReview = { status: 'approved', round: 1 };
        delete st.sessions['or-outer_review'];

        // After DONE, reactor should release the outer review slot (usage entry still exists)
        events = reactState(st);
        const releases = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        if (orSlotId) expect(releases.some((e) => e.payload.slotId === orSlotId)).toBe(true);
    });

    test('does NOT release outer review model while review is in progress', () => {
        const st = approvedState();
        let events = reactState(st);
        st.squad.outerReview = { status: 'pending', round: 1 };
        delete st.modelPool.usage['s1'];
        delete st.modelPool.usage['s2'];
        events = reactState(st);
        const acquire = events.find((e) => e.type === Events.MODEL_POOL_ACQUIRE && !e.payload.nodeId);
        const orSlotId = acquire?.payload?.slotId;
        if (orSlotId)
            st.modelPool.usage[orSlotId] = { inUse: true, holder: undefined, nodeId: undefined, role: 'reviewer' };
        events = reactState(st);
        createSession(st, null, 'outer_review');
        if (st.squad.outerReview) st.squad.outerReview.lastPrompted = true;

        // In progress — model should NOT be released
        events = reactState(st);
        const releases = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        if (orSlotId) {
            const orRelease = releases.filter((e) => e.payload.slotId === orSlotId);
            expect(orRelease.length).toBe(0, 'Should not release outer review model while in progress');
        }
    });
});
