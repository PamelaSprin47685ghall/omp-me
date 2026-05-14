/**
 * Algebraic tests for Outer Review phase.
 * Given event arrays, assert command arrays — no async, no mocks.
 * MODEL_POOL_ACQUIRE/RELEASE are now direct facts emitted by the reactor.
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

function appendAll(l, events) {
    for (const e of events) l.append(e.type, e.payload);
}

function makeApprovedNodeLog() {
    const l = log();
    l.append(Events.SQUAD_INIT, {
        mode: 'L',
        nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
        originalTask: 'build the thing',
    });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
    l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
    l.append(Events.SESSION_START, { sessionId: 's1s', nodeId: 'n1', phase: 'worker' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.CONFIRMING });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.REVIEWING });
    l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's2', nodeId: 'n1', sessionId: 'n1', role: 'reviewer' });
    l.append(Events.SESSION_START, { sessionId: 's2s', nodeId: 'n1', phase: 'reviewer' });
    l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });
    l.append('model_pool:snapshot', {
        slots: [
            { slotId: 's1', provider: 'test', modelId: 'w1', role: 'worker' },
            { slotId: 's2', provider: 'test', modelId: 'r1', role: 'reviewer' },
        ],
    });
    return l;
}

describe('outer review — happy path', () => {
    test('emits SQUAD_OUTER_REVIEW_START when all nodes approved', () => {
        const l = makeApprovedNodeLog();
        const events = reactState(project(l.getSince(0)));
        // Model release (for s1, s2) + SQUAD_OUTER_REVIEW_START
        const startEvent = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(startEvent).toBeDefined();
        expect(startEvent.payload.round).toBe(1);
    });

    test('full lifecycle: start → acquire → create → prompt → done → complete', () => {
        const l = makeApprovedNodeLog();

        // Step 1: emit SQUAD_OUTER_REVIEW_START + MODEL_POOL_RELEASE for s1,s2
        let events = reactState(project(l.getSince(0)));
        const startEvent = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(startEvent).toBeDefined();
        appendAll(l, events);

        // Step 2: reactor emits MODEL_POOL_ACQUIRE for outer review (first free reviewer slot)
        events = reactState(project(l.getSince(0)));
        const acquireEvent = events.find((e) => e.type === Events.MODEL_POOL_ACQUIRE && !e.payload.nodeId);
        expect(acquireEvent).toBeDefined();
        expect(acquireEvent.payload.role).toBe('reviewer');
        appendAll(l, events);

        // Step 3: CMD_CREATE_SESSION for outer_review
        events = reactState(project(l.getSince(0)));
        const createSession = events.find(
            (e) => e.type === Events.CMD_CREATE_SESSION && e.payload.phase === 'outer_review',
        );
        expect(createSession).toBeDefined();
        expect(createSession.payload.slotId).toBe(acquireEvent.payload.slotId);
        appendAll(l, events);

        // Step 4: SESSION_START (simulate side effects)
        l.append(Events.SESSION_START, { sessionId: 'or-sess', phase: 'outer_review' });

        // Step 5: CMD_PROMPT for outer_review
        events = reactState(project(l.getSince(0)));
        const promptCmd = events.find((e) => e.type === Events.CMD_PROMPT && e.payload.phase === 'outer_review');
        expect(promptCmd).toBeDefined();
        expect(promptCmd.payload.sessionId).toBe('or-sess');
        appendAll(l, events);

        // Step 5b: Engine would append SESSION_PROMPTING transitional fact before sending
        l.append(Events.SESSION_PROMPTING, { sessionId: 'or-sess', phase: 'outer_review' });

        // Step 6: no more outer-review events
        events = reactState(project(l.getSince(0)));
        const orEvents = events.filter((e) => e.type !== Events.MODEL_POOL_RELEASE);
        expect(orEvents.length).toBe(0, 'No events besides model releases after prompt sent');

        // Step 7: SESSION_TOOL_CALL with return ok
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'or-sess',
            toolName: 'return',
            params: { status: 'ok', reason: 'all good' },
        });

        // Step 8: SQUAD_OUTER_REVIEW_DONE
        events = reactState(project(l.getSince(0)));
        const doneEvent = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_DONE);
        expect(doneEvent).toBeDefined();
        appendAll(l, events);

        // Step 9: SQUAD_COMPLETE
        events = reactState(project(l.getSince(0)));
        const completeEvent = events.find((e) => e.type === Events.SQUAD_COMPLETE);
        expect(completeEvent).toBeDefined();
        expect(completeEvent.payload.results[0].nodeId).toBe('n1');
    });
});

describe('outer review — rejection path', () => {
    test('failed review: two-step (FAILED event then node resets)', () => {
        const l = makeApprovedNodeLog();

        // Start outer review through to prompt
        let events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        l.append(Events.SESSION_START, { sessionId: 'or-sess', phase: 'outer_review' });
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        l.append(Events.SESSION_PROMPTING, { sessionId: 'or-sess', phase: 'outer_review' });

        // Return with error
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'or-sess',
            toolName: 'return',
            params: { status: 'error', reason: 'does not meet requirements' },
        });

        // Step 1: SQUAD_OUTER_REVIEW_FAILED emitted
        events = reactState(project(l.getSince(0)));
        const failedEvent = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_FAILED);
        expect(failedEvent).toBeDefined();
        expect(failedEvent.payload.reason).toBe('does not meet requirements');
        appendAll(l, events);

        // Step 2: All approved nodes reset to AUTHORING
        events = reactState(project(l.getSince(0)));
        const resetEvents = events.filter(
            (e) => e.type === Events.SQUAD_NODE_STATE && e.payload.status === STATUS.AUTHORING,
        );
        expect(resetEvents.length).toBe(1);
        expect(resetEvents[0].payload.nodeId).toBe('n1');
        expect(resetEvents[0].payload.feedback).toBe('does not meet requirements');
        expect(resetEvents[0].payload.retryCount).toBe(1);
    });

    test('after reset and re-approval, starts new outer review round', () => {
        const l = makeApprovedNodeLog();

        // Run first outer review to failure
        let events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        l.append(Events.SESSION_START, { sessionId: 'or-sess', phase: 'outer_review' });
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        l.append(Events.SESSION_PROMPTING, { sessionId: 'or-sess', phase: 'outer_review' });
        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'or-sess',
            toolName: 'return',
            params: { status: 'error', reason: 'bad' },
        });

        // Step 1: FAILED emitted
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);

        // Step 2: Node reset (n1 → AUTHORING)
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);

        // Now simulate the node being reprocessed to APPROVED again
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.REVIEWING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });

        // All nodes APPROVED again with FAILED in log — should start new round
        events = reactState(project(l.getSince(0)));
        const startEvent = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(startEvent).toBeDefined();
        expect(startEvent.payload.round).toBe(2);
    });
});

describe('outer review — model release', () => {
    test('releases outer review model after DONE', () => {
        const l = makeApprovedNodeLog();

        // Run outer review to DONE
        let events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        l.append(Events.SESSION_START, { sessionId: 'or-sess', phase: 'outer_review' });
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        l.append(Events.SESSION_PROMPTING, { sessionId: 'or-sess', phase: 'outer_review' });

        l.append(Events.SESSION_TOOL_CALL, {
            sessionId: 'or-sess',
            toolName: 'return',
            params: { status: 'ok', reason: 'approved' },
        });
        events = reactState(project(l.getSince(0)));
        // SQUAD_OUTER_REVIEW_DONE + SESSION_END
        appendAll(l, events);

        // After DONE, model release should include the outer review slot
        events = reactState(project(l.getSince(0)));
        const releases = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        // Should release worker slot (s1) and outer review slot (was acquired during outer review)
        const orSlotId = l
            .all()
            .find((e) => e.event === Events.MODEL_POOL_ACQUIRE && e.payload.role === 'reviewer' && !e.payload.nodeId)
            ?.payload?.slotId;
        expect(releases.some((e) => e.payload.slotId === orSlotId)).toBe(true);
    });

    test('does NOT release outer review model while review is in progress', () => {
        const l = makeApprovedNodeLog();

        // Start outer review and acquire model
        let events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        events = reactState(project(l.getSince(0)));
        appendAll(l, events);
        l.append(Events.SESSION_START, { sessionId: 'or-sess', phase: 'outer_review' });

        // Outer review in progress — model should NOT be released
        events = reactState(project(l.getSince(0)));
        const releases = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        const orSlotId = l
            .all()
            .find((e) => e.event === Events.MODEL_POOL_ACQUIRE && e.payload.role === 'reviewer' && !e.payload.nodeId)
            ?.payload?.slotId;
        const orRelease = releases.filter((e) => e.payload.slotId === orSlotId);
        expect(orRelease.length).toBe(0, 'Should not release outer review model while in progress');
    });
});
