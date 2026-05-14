/**
 * Trace the full n1 lifecycle: authoring → confirming → reviewing → approved.
 * Simulates the engine loop + side effects for each step.
 * Uses EventLog + reactState loop to verify drain-safe invariant at every step.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { EventLog } from '../../server/event-log.js';

function setup() {
    const eventLog = new EventLog();
    eventLog.append('model_pool:snapshot', {
        slots: [
            { slotId: 'slot-w1', role: 'worker', provider: 'test', modelId: 'worker-1', thinkingLevel: null },
            { slotId: 'slot-w2', role: 'worker', provider: 'test', modelId: 'worker-2', thinkingLevel: null },
            { slotId: 'slot-r1', role: 'reviewer', provider: 'test', modelId: 'reviewer-1', thinkingLevel: null },
        ],
    });
    eventLog.append(Events.SQUAD_INIT, {
        mode: 'L',
        nodes: [
            { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
            { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
        ],
        originalTask: 'test',
    });

    function engineStep() {
        const log = eventLog.getSince(0);
        const events = reactState(project(log));
        for (const e of events) eventLog.append(e.type, e.payload);
        return events;
    }

    return { eventLog, engineStep };
}

describe('full chain lifecycle trace', () => {
    test('traces drain-safe for each reactor invocation', () => {
        const { eventLog, engineStep } = setup();
        let events;

        // Step 0: idle transitions
        events = engineStep();
        expect(events.length).toBe(2);
        expect(events[0].payload.status).toBe('idle');
        expect(events[1].payload.status).toBe('idle');

        // Step 1: n1 → AUTHORING
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].payload.nodeId).toBe('n1');
        expect(events[0].payload.status).toBe(STATUS.AUTHORING);

        // Step 2: MODEL_POOL_ACQUIRE for worker
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.MODEL_POOL_ACQUIRE);
        expect(events[0].payload.role).toBe('worker');

        // --- Simulate model acquisition by engine side-effects ---
        eventLog.append(Events.MODEL_POOL_ACQUIRE, {
            slotId: 'slot-w1',
            nodeId: 'n1',
            sessionId: 'n1',
            role: 'worker',
        });

        // Step 3: SESSION_CREATING (authoring)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SESSION_CREATING);
        expect(events[0].payload.phase).toBe('worker');

        // Step 4: no events (sessionStatus='creating' prevents re-emission)
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Side effects: create session ---
        const sessWorker = 'sess-n1-worker';
        eventLog.append(Events.SESSION_START, {
            sessionId: sessWorker,
            nodeId: 'n1',
            phase: 'worker',
            model: { provider: 'test', id: 'worker-1' },
        });

        // Step 5: SESSION_PROMPTING (authoring)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SESSION_PROMPTING);
        expect(events[0].payload.phase).toBe('authoring');

        // Step 6: no events (sessionStatus='prompting' prevents re-emission)
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Side effects: authoring returns ---
        eventLog.append(Events.SESSION_TOOL_CALL, {
            sessionId: sessWorker,
            toolName: 'return',
            toolId: 'call-1',
            params: { status: 'ok', reason: 'done', affected_files: ['f.js'] },
        });

        // Step 7: n1 → CONFIRMING
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].payload.status).toBe(STATUS.CONFIRMING);

        // Step 8: SESSION_CREATING for confirming (reuses worker slot)
        events = engineStep();
        expect(events.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE).length).toBe(0);
        const createConfirm = events.filter((e) => e.type === Events.SESSION_CREATING);
        expect(createConfirm.length).toBe(1);
        expect(createConfirm[0].payload.phase).toBe('worker_confirm');
        expect(createConfirm[0].payload.slotId).toBe('slot-w1');

        // Step 9: no events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Side effects: create confirming session ---
        const sessConfirm = 'sess-n1-confirm';
        eventLog.append(Events.SESSION_START, {
            sessionId: sessConfirm,
            nodeId: 'n1',
            phase: 'worker_confirm',
            model: { provider: 'test', id: 'worker-1' },
        });

        // Step 10: SESSION_PROMPTING (confirming)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SESSION_PROMPTING);
        expect(events[0].payload.phase).toBe('confirming');

        // Step 11: no events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Side effects: confirming returns ---
        eventLog.append(Events.SESSION_TOOL_CALL, {
            sessionId: sessConfirm,
            toolName: 'return',
            toolId: 'call-2',
            params: { status: 'ok', reason: 'confirmed', affected_files: [] },
        });

        // Step 12: n1 → REVIEWING
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].payload.status).toBe(STATUS.REVIEWING);

        // Step 13: MODEL_POOL_ACQUIRE for reviewer
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.MODEL_POOL_ACQUIRE);
        expect(events[0].payload.role).toBe('reviewer');

        // --- Side effects: acquire reviewer model ---
        eventLog.append(Events.MODEL_POOL_ACQUIRE, {
            slotId: 'slot-r1',
            nodeId: 'n1',
            sessionId: 'n1',
            role: 'reviewer',
        });

        // Step 14: SESSION_CREATING for reviewer
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SESSION_CREATING);
        expect(events[0].payload.phase).toBe('reviewer');

        // Step 15: no events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Side effects: create reviewer session ---
        const sessReview = 'sess-n1-review';
        eventLog.append(Events.SESSION_START, {
            sessionId: sessReview,
            nodeId: 'n1',
            phase: 'reviewer',
            model: { provider: 'test', id: 'reviewer-1' },
        });

        // Step 16: SESSION_PROMPTING (reviewer)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SESSION_PROMPTING);
        expect(events[0].payload.phase).toBe('reviewer');

        // Step 17: no events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Side effects: reviewer returns ok ---
        eventLog.append(Events.SESSION_TOOL_CALL, {
            sessionId: sessReview,
            toolName: 'return',
            toolId: 'call-3',
            params: { status: 'ok', reason: 'approved', affected_files: [] },
        });

        // Step 18: n1 → APPROVED
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].payload.status).toBe(STATUS.APPROVED);

        // Step 19: model release + n2 wakes up
        events = engineStep();
        const releases = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        expect(releases.length).toBe(2, 'Should release both worker and reviewer slots');
        expect(events.some((e) => e.payload.nodeId === 'n2' && e.payload.status === STATUS.AUTHORING)).toBe(true);
    });
});
