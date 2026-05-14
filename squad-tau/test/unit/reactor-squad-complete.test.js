/**
 * Algebraic tests for SQUAD_COMPLETE emission conditions.
 * Pure algebraic: f(state) → Action[]. No event logs, no mocks.
 *
 * Covers: happy path (outer review gate), rejection path, edge cases.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { createBaseState, setStatus, createSession, giveReturn, acquireModel } from '../helpers/state-builder.js';

/**
 * Fast-forward a node through the full approval pipeline with sessions.
 */
function approveNode(state, nodeId) {
    setStatus(state, nodeId, 'idle');
    setStatus(state, nodeId, STATUS.AUTHORING);
    acquireModel(state, nodeId, 'worker', `${nodeId}-w`);
    createSession(state, nodeId, 'worker');
    setStatus(state, nodeId, STATUS.CONFIRMING);
    createSession(state, nodeId, 'worker_confirm');
    setStatus(state, nodeId, STATUS.REVIEWING);
    acquireModel(state, nodeId, 'reviewer', `${nodeId}-r`);
    createSession(state, nodeId, 'reviewer');
    setStatus(state, nodeId, STATUS.APPROVED, { summary: `${nodeId} done` });
}

describe('SQUAD_COMPLETE — happy path (outer review gate)', () => {
    test('all nodes APPROVED + outer review DONE emits SQUAD_COMPLETE with results', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');

        // Set outer review done
        st.squad.outerReview = { status: 'approved', round: 1 };

        const events = reactState(st);
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();
        expect(complete.payload.results.length).toBe(1);
        expect(complete.payload.results[0].nodeId).toBe('n1');
        expect(complete.payload.results[0].status).toBe(STATUS.APPROVED);
    });

    test('SQUAD_COMPLETE result entries carry summary from node state', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');
        setStatus(st, 'n1', STATUS.APPROVED, { summary: 'implementation complete', affectedFiles: ['a.js'] });
        st.squad.outerReview = { status: 'approved', round: 1 };

        const events = reactState(st);
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        const result = complete.payload.results.find((r) => r.nodeId === 'n1');
        expect(result.summary).toBe('implementation complete');
    });

    test('SQUAD_COMPLETE emitted only once (idempotent)', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');
        st.squad.outerReview = { status: 'approved', round: 1 };

        let events = reactState(st);
        expect(events.some((e) => e.type === Events.SQUAD_COMPLETE)).toBe(true);

        // Mark squad complete — reactor sees status='complete' and returns nothing
        st.squad.status = 'complete';
        events = reactState(st);
        expect(events.length).toBe(0);
    });
});

describe('SQUAD_COMPLETE — outer review rejection path', () => {
    test('outer review FAILED without node reset does NOT emit SQUAD_COMPLETE', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');
        st.squad.outerReview = { status: 'rejected', round: 1, feedback: 'needs rework' };

        const events = reactState(st);
        expect(events.find((e) => e.type === Events.SQUAD_COMPLETE)).toBeUndefined(
            'no SQUAD_COMPLETE after outer review FAILED',
        );

        const reset = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(reset).toBeDefined();
        expect(reset.payload.feedback).toBe('needs rework');
        expect(reset.payload.retryCount).toBe(1);
    });

    test('after reset and re-approval, new outer review round starts', () => {
        const st = createBaseState('n1');
        approveNode(st, 'n1');
        st.squad.outerReview = { status: 'rejected', round: 1, feedback: 'rejected' };

        // Step 1: reactor emits node reset
        let events = reactState(st);
        const reset = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(reset).toBeDefined();
        expect(events.some((e) => e.type === Events.SQUAD_COMPLETE)).toBe(false);

        // Apply reset: n1 → AUTHORING, retryCount=1, sessions cleared
        setStatus(st, 'n1', STATUS.AUTHORING, { retryCount: 1, feedback: 'rejected' });
        st.squad.nodes[0].authoringSessionId = null;
        st.squad.nodes[0].confirmingSessionId = null;
        st.squad.nodes[0].reviewerSessionId = null;
        delete st.sessions['n1-worker'];
        delete st.sessions['n1-worker_confirm'];
        delete st.sessions['n1-reviewer'];
        // outerReview stays as { status: 'rejected', round: 1, feedback: 'rejected' } (projection state)

        // Re-approve the node
        approveNode(st, 'n1');

        events = reactState(st);
        const orStart = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(orStart).toBeDefined();
        expect(orStart.payload.round).toBe(2);
    });
});

describe('SQUAD_COMPLETE — edge cases', () => {
    test('no nodes (empty squad) produces no events', () => {
        const st = createBaseState();
        st.squad.nodes = [];
        expect(reactState(st).length).toBe(0);
    });

    test('squad complete payload maps result objects correctly', () => {
        const st = createBaseState('A', 'B');
        setStatus(st, 'A', 'idle');
        setStatus(st, 'B', 'idle');
        setStatus(st, 'A', STATUS.AUTHORING);
        setStatus(st, 'A', STATUS.APPROVED, { summary: 'A ok' });
        setStatus(st, 'B', STATUS.AUTHORING);
        setStatus(st, 'B', STATUS.FAILED);

        const events = reactState(st);
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();

        const results = complete.payload.results;
        expect(results.length).toBe(2);
        expect(results.find((r) => r.nodeId === 'A').status).toBe(STATUS.APPROVED);
        expect(results.find((r) => r.nodeId === 'A').summary).toBe('A ok');
        expect(results.find((r) => r.nodeId === 'B').status).toBe(STATUS.FAILED);
    });
});
