/**
 * Algebraic tests for node state machine failure and retry paths.
 * Ported invariants from deprecated tests:
 *   - run-reviewer.test.js (reviewer rejection → retry)
 *   - squad-flow.test.js (reject → retry → approve cycle)
 *   - dag-execute.test.js (blocked propagation)
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

/**
 * Build a log with a single node progressed through to REVIEWING state.
 */
function nodeThroughReviewing(name = 'n1') {
    const l = log();
    l.append(Events.SQUAD_INIT, {
        mode: 'M',
        nodes: [{ id: name, task: 'task', review_criteria: [], depends_on: [] }],
        originalTask: 'test',
    });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: 'idle' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: STATUS.AUTHORING });
    l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: name, role: 'worker' });
    l.append(Events.SESSION_START, { sessionId: 'ss1', nodeId: name, phase: 'worker' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: STATUS.CONFIRMING });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: name, status: STATUS.REVIEWING });
    l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's2', nodeId: name, role: 'reviewer' });
    l.append(Events.SESSION_START, { sessionId: 'ss2', nodeId: name, phase: 'reviewer' });
    return l;
}

describe('reviewer rejection', () => {
    test('reviewer return error sends node back to AUTHORING with retryCount and feedback', () => {
        const l = nodeThroughReviewing();

        // Append reviewer rejection
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'ss2',
            toolName: 'return',
            toolId: 'call-1',
            params: { status: 'error', reason: 'needs more work' },
        });

        const events = reactState(project(l.getSince(0)));
        const authEvent = events.find(
            (e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING,
        );
        expect(authEvent).toBeDefined();
        expect(authEvent.payload.nodeId).toBe('n1');
        expect(authEvent.payload.retryCount).toBe(1);
        expect(authEvent.payload.feedback).toBe('needs more work');
    });

    test('retryCount increments on repeated rejections', () => {
        const l = nodeThroughReviewing();

        // First rejection
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'ss2',
            toolName: 'return',
            toolId: 'call-1',
            params: { status: 'error', reason: 'fix 1' },
        });
        let events = reactState(project(l.getSince(0)));
        const auth1 = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(auth1).toBeDefined();
        expect(auth1.payload.retryCount).toBe(1);
        expect(auth1.payload.feedback).toBe('fix 1');
        l.append(auth1.type, auth1.payload);

        // Retry path: new authoring session → return → confirming → new reviewer session
        // Projection cleared all session IDs on retry; reactor starts fresh.
        // Simulate new authoring session (reuses worker slot from first pass)
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1-new', nodeId: 'n1', role: 'worker' });
        l.append(Events.SESSION_START, { sessionId: 'ss1-retry', nodeId: 'n1', phase: 'worker' });
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'ss1-retry',
            toolName: 'return',
            toolId: 'call-ret-1',
            params: { status: 'ok', reason: 'done again' },
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.CONFIRMING });

        // Simulate confirming (reuses worker slot)
        l.append(Events.SESSION_START, { sessionId: 'ss1-conf-retry', nodeId: 'n1', phase: 'worker_confirm' });
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'ss1-conf-retry',
            toolName: 'return',
            toolId: 'call-conf-ret',
            params: { status: 'ok', reason: 'confirmed again' },
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.REVIEWING });

        // New reviewer session (reuses reviewer slot from first pass)
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's2-new', nodeId: 'n1', role: 'reviewer' });
        l.append(Events.SESSION_START, { sessionId: 'ss2-retry', nodeId: 'n1', phase: 'reviewer' });

        // Second rejection in the NEW session
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'ss2-retry',
            toolName: 'return',
            toolId: 'call-2',
            params: { status: 'error', reason: 'fix 2' },
        });

        events = reactState(project(l.getSince(0)));
        const auth2 = events.find((e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING);
        expect(auth2).toBeDefined();
        expect(auth2.payload.retryCount).toBe(2);
        expect(auth2.payload.feedback).toBe('fix 2');
    });

    test('reviewer approval transitions node to APPROVED', () => {
        const l = nodeThroughReviewing();

        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'ss2',
            toolName: 'return',
            toolId: 'call-1',
            params: { status: 'ok', reason: 'good work' },
        });

        const events = reactState(project(l.getSince(0)));
        const approveEvent = events.find(
            (e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.APPROVED,
        );
        expect(approveEvent).toBeDefined();
        expect(approveEvent.payload.nodeId).toBe('n1');
        expect(approveEvent.payload.summary).toBe('good work');
    });
});

describe('blocked node invariants', () => {
    test('blocked node stays blocked across repeated reactor calls', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
            ],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.FAILED });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: STATUS.BLOCKED });

        // Three consecutive calls should each produce no BLOCKED duplicates
        for (let i = 0; i < 3; i++) {
            const events = reactState(project(l.getSince(0)));
            const blockEvents = events.filter((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.BLOCKED);
            expect(blockEvents.length).toBe(0, `no duplicate BLOCKED on call ${i + 1}`);
        }
    });

    test('blocked node does not prevent other terminal node processing', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
                { id: 'n3', task: 'third', review_criteria: [], depends_on: [] },
            ],
            originalTask: 'test',
        });
        // n1 failed, n2 blocked, n3 independent and approved
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n3', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.FAILED });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: STATUS.BLOCKED });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n3', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n3', status: STATUS.APPROVED });

        // n1 (FAILED) + n3 (APPROVED) + n2 (BLOCKED) = all terminal → complete
        const events = reactState(project(l.getSince(0)));
        const complete = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(complete).toBeDefined();
        expect(complete.payload.results.map((r) => r.nodeId)).toEqual(expect.arrayContaining(['n1', 'n2', 'n3']));
        expect(complete.payload.results.find((r) => r.nodeId === 'n2').status).toBe(STATUS.BLOCKED);
    });
});

describe('abort handling', () => {
    test('SQUAD_ABORT causes react to return empty array immediately', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 'task', review_criteria: [], depends_on: [] }],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_ABORT, { reason: 'user cancelled' });

        const events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(0);
    });

    test('aborted squad ignores subsequent node processing', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
            ],
            originalTask: 'test',
        });
        // Abort immediately before any processing
        l.append(Events.SQUAD_ABORT, { reason: 'cancelled' });

        // Even with pending transitions, nothing should be emitted
        const events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(0);
    });

    test('abort does not affect already-terminated squad', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 'task', review_criteria: [], depends_on: [] }],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_COMPLETE, { results: [] });

        // Squad is already complete, reactor returns empty
        expect(reactState(project(l.getSince(0))).length).toBe(0);

        // Even if we append abort after complete, still empty
        l.append(Events.SQUAD_ABORT, { reason: 'too late' });
        expect(reactState(project(l.getSince(0))).length).toBe(0);
    });
});
