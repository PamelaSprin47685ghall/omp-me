/**
 * Algebraic tests for SQUAD_COMPLETE emission conditions.
 * Verifies the reactor's completion gate logic.
 *
 * Ported invariants from deprecated tests:
 *   - squad-complete.test.js (event emission, result mapping)
 *   - squad-flow.test.js (outer review gate)
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';

function log() {
    const a = [];
    let i = 0;
    return {
        append(e, p) {
            const o = { id: i++, event: e, payload: p };
            a.push(o);
            return o;
        },
        getSince(n = 0) {
            return a.slice(n);
        },
        all() {
            return a;
        },
    };
}

function makeNodeLog(name, deps) {
    const l = log();
    l.append(Events.SQUAD_INIT, {
        mode: 'L',
        nodes: [{ id: name, task: 'task', review_criteria: [], depends_on: deps || [] }],
        originalTask: 'build feature',
    });
    return l;
}

function fastForwardApproved(l, name) {
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: 'idle' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: STATUS.AUTHORING });
    l.append(Events.MODEL_POOL_ACQUIRE, { slotId: `${name}-w`, nodeId: name, role: 'worker' });
    l.append(Events.SESSION_START, { sessionId: `${name}-ws`, nodeId: name, phase: 'worker' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: STATUS.CONFIRMING });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: STATUS.REVIEWING });
    l.append(Events.MODEL_POOL_ACQUIRE, { slotId: `${name}-r`, nodeId: name, role: 'reviewer' });
    l.append(Events.SESSION_START, { sessionId: `${name}-rs`, nodeId: name, phase: 'reviewer' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: STATUS.APPROVED, summary: `${name} done` });
}

/**
 * Build a log with a single node fully APPROVED + outer review DONE.
 */
function fullApprovedWithOR() {
    const l = makeNodeLog('n1');
    fastForwardApproved(l, 'n1');
    l.append('model_pool:snapshot', {
        slots: [
            { slotId: 'n1-w', provider: 'test', modelId: 'w1', role: 'worker' },
            { slotId: 'n1-r', provider: 'test', modelId: 'r1', role: 'reviewer' },
        ],
    });
    l.append(Events.SQUAD_OUTER_REVIEW_START, { round: 1 });
    l.append(Events.SQUAD_OUTER_REVIEW_DONE, { reason: 'all good' });
    return l;
}

describe('SQUAD_COMPLETE — happy path (outer review gate)', () => {
    test('all nodes APPROVED + outer review DONE emits SQUAD_COMPLETE with results', () => {
        const l = fullApprovedWithOR();
        const events = reactState(project(l.getSince(0)));

        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();
        expect(complete.payload.results).toBeDefined();
        expect(complete.payload.results.length).toBe(1);
        expect(complete.payload.results[0].nodeId).toBe('n1');
        expect(complete.payload.results[0].status).toBe(STATUS.APPROVED);
    });

    test('SQUAD_COMPLETE result entries carry summary from node state', () => {
        const l = makeNodeLog('n1');
        fastForwardApproved(l, 'n1', { summary: 'implementation complete' });
        // Override the summary via a new state event
        l.append(Events.SQUAD_NODE_STATE, {
            nodeId: 'n1',
            status: STATUS.APPROVED,
            summary: 'implementation complete',
            affectedFiles: ['a.js'],
        });
        l.append(Events.SQUAD_OUTER_REVIEW_START, { round: 1 });
        l.append(Events.SQUAD_OUTER_REVIEW_DONE, { reason: 'ok' });

        const events = reactState(project(l.getSince(0)));
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        const result = complete.payload.results.find((r) => r.nodeId === 'n1');
        expect(result.summary).toBe('implementation complete');
    });

    test('SQUAD_COMPLETE emitted only once (idempotent)', () => {
        const l = fullApprovedWithOR();

        // First call: SQUAD_COMPLETE emitted
        let events = reactState(project(l.getSince(0)));
        expect(events.some((e) => e.type === Events.SQUAD_COMPLETE)).toBe(true);

        // Append the SQUAD_COMPLETE event to log
        const completeEvent = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        l.append(completeEvent.type, completeEvent.payload);

        // Second call: squad status is now 'complete' → no events
        events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(0);
    });
});

describe('SQUAD_COMPLETE — outer review rejection path', () => {
    test('outer review FAILED without node reset does NOT emit SQUAD_COMPLETE', () => {
        const l = makeNodeLog('n1');
        fastForwardApproved(l, 'n1');
        l.append('model_pool:snapshot', { slots: [] });
        l.append(Events.SQUAD_OUTER_REVIEW_START, { round: 1 });
        l.append(Events.SQUAD_OUTER_REVIEW_FAILED, { reason: 'needs rework' });

        const events = reactState(project(l.getSince(0)));
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeUndefined('no SQUAD_COMPLETE after outer review FAILED');

        // Instead, node should be reset to AUTHORING
        const reset = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(reset).toBeDefined();
        expect(reset.payload.feedback).toBe('needs rework');
        expect(reset.payload.retryCount).toBe(1);
    });

    test('after reset and re-approval, new outer review round starts', () => {
        const l = makeNodeLog('n1');
        fastForwardApproved(l, 'n1');
        l.append(Events.SQUAD_OUTER_REVIEW_START, { round: 1 });
        l.append(Events.SQUAD_OUTER_REVIEW_FAILED, { reason: 'rejected' });

        // Step 1: reactor emits node reset
        let events = reactState(project(l.getSince(0)));
        const resetEvent = events.find(
            (e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING,
        );
        expect(resetEvent).toBeDefined();
        l.append(resetEvent.type, resetEvent.payload);
        // Also append model releases from the same batch
        for (const e of events.filter((e) => e.type === Events.MODEL_POOL_RELEASE)) {
            l.append(e.type, e.payload);
        }

        // No SQUAD_COMPLETE yet
        expect(events.some((e) => e.type === Events.SQUAD_COMPLETE)).toBe(false);

        // Step 2: re-approve the node
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.REVIEWING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });

        // Should start outer review round 2 (not DONE yet)
        events = reactState(project(l.getSince(0)));
        const orStart = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(orStart).toBeDefined();
        expect(orStart.payload.round).toBe(2);
    });
});

describe('SQUAD_COMPLETE — edge cases', () => {
    test('no nodes (empty squad) produces no events', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [],
            originalTask: 'empty',
        });

        const events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(0);
    });

    test('squad complete payload maps result objects correctly', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'A', task: 'a', review_criteria: [], depends_on: [] },
                { id: 'B', task: 'b', review_criteria: [], depends_on: [] },
            ],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'A', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'B', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'A', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'A', status: STATUS.APPROVED, summary: 'A ok' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'B', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'B', status: STATUS.FAILED });

        // Mixed terminal states → complete without outer review
        const events = reactState(project(l.getSince(0)));
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();

        const results = complete.payload.results;
        expect(results.length).toBe(2);
        expect(results.find((r) => r.nodeId === 'A').status).toBe(STATUS.APPROVED);
        expect(results.find((r) => r.nodeId === 'A').summary).toBe('A ok');
        expect(results.find((r) => r.nodeId === 'B').status).toBe(STATUS.FAILED);
    });
});
