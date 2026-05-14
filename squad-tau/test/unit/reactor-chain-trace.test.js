/**
 * Trace the full n1 lifecycle: authoring → confirming → reviewing → approved.
 * Simulates the engine loop + side effects for each step.
 * No ModelPool class — slots are seeded directly via event log events.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { EventLog } from '../../server/event-log.js';

function setup() {
    const eventLog = new EventLog();

    // Initialize model pool snapshot directly (no ModelPool class)
    eventLog.append('model_pool:snapshot', {
        slots: [
            { slotId: 'slot-w1', provider: 'test', modelId: 'worker-1', role: 'worker', thinkingLevel: null },
            { slotId: 'slot-w2', provider: 'test', modelId: 'worker-2', role: 'worker', thinkingLevel: null },
            { slotId: 'slot-r1', provider: 'test', modelId: 'reviewer-1', role: 'reviewer', thinkingLevel: null },
        ],
    });

    // Initialize squad
    eventLog.append(Events.SQUAD_INIT, {
        mode: 'L',
        nodes: [
            { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
            { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
        ],
        originalTask: 'test',
    });

    // Run reactor loop once to get through idle/blocked setup
    function engineStep() {
        const log = eventLog.getSince(0);
        const events = reactState(project(log));
        for (const e of events) {
            eventLog.append(e.type, e.payload);
        }
        return events;
    }

    return { eventLog, engineStep };
}

describe('full chain lifecycle trace', () => {
    test('traces drain-safe for each reactor invocation', () => {
        const { eventLog, engineStep } = setup();

        // Step 0: idle transitions (both nodes from undefined → idle)
        let events = engineStep();
        expect(events.length).toBe(2);
        expect(events[0].payload.status).toBe('idle');
        expect(events[1].payload.status).toBe('idle');

        // Step 1: n1 idle → authoring, n2 stays idle (deps not met)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].payload.nodeId).toBe('n1');
        expect(events[0].payload.status).toBe(STATUS.AUTHORING);

        // Step 2: n1 authoring → MODEL_POOL_ACQUIRE (direct fact, not CMD)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.MODEL_POOL_ACQUIRE);
        expect(events[0].payload.nodeId).toBe('n1');
        expect(events[0].payload.role).toBe('worker');

        // Step 3: reactor re-emits MODEL_POOL_ACQUIRE until acquired (no hasPendingCommand)
        //         Now with MODEL_POOL_ACQUIRE as a fact, the projection updates immediately.
        //         Re-running would still emit: reactor doesn't check usage for acquire emission.
        //         But the engine pulse debounces and engine checks state — let's simulate.

        // --- Simulate the fact was appended by engine: model acquired ---
        eventLog.append(Events.MODEL_POOL_ACQUIRE, {
            slotId: 'slot-w1',
            nodeId: 'n1',
            sessionId: 'n1',
            role: 'worker',
        });

        // Step 4: model acquired → CMD_CREATE_SESSION (authoring)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.CMD_CREATE_SESSION);
        expect(events[0].payload.phase).toBe('worker');

        // Step 4b: Engine appends SESSION_CREATING transitional fact
        eventLog.append(Events.SESSION_CREATING, { nodeId: 'n1', phase: 'worker' });

        // Step 5: no new events (SESSION_CREATING prevents CMD_CREATE_SESSION re-emission)
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Simulate side effects: create session ---
        const sessWorkerId = 'sess-n1-worker';
        eventLog.append(Events.SESSION_START, {
            sessionId: sessWorkerId,
            nodeId: 'n1',
            phase: 'worker',
            model: { provider: 'test', id: 'worker-1' },
        });

        // Step 6: session exists → CMD_PROMPT (authoring)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.CMD_PROMPT);
        expect(events[0].payload.phase).toBe('authoring');

        // Step 6b: Engine appends SESSION_PROMPTING before sending
        eventLog.append(Events.SESSION_PROMPTING, { sessionId: sessWorkerId, phase: 'authoring' });

        // Step 7: no new events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Simulate side effects: prompt returns tool_call 'return' ---
        eventLog.append(Events.SESSION_TOOL_CALL, {
            sessionId: sessWorkerId,
            toolName: 'return',
            toolId: 'call-1',
            params: { status: 'ok', reason: 'done', affected_files: ['f.js'] },
        });

        // Step 8: n1 → CONFIRMING
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SQUAD_NODE_STATE);
        expect(events[0].payload.status).toBe(STATUS.CONFIRMING);

        // Step 9: confirming → should reuse model (slot-w1 still assigned to n1) → CMD_CREATE_SESSION
        events = engineStep();
        const acquireInConfirm = events.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE);
        expect(acquireInConfirm.length).toBe(0, 'Should NOT acquire new model for confirming');
        const createInConfirm = events.filter((e) => e.type === Events.CMD_CREATE_SESSION);
        expect(createInConfirm.length).toBe(1, 'Should create session for confirming');
        expect(createInConfirm[0].payload.phase).toBe('worker_confirm');
        expect(createInConfirm[0].payload.slotId).toBe('slot-w1');

        // Step 9b: Engine appends SESSION_CREATING for confirming
        eventLog.append(Events.SESSION_CREATING, { nodeId: 'n1', phase: 'worker_confirm' });

        // Step 10: no new events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Simulate side effects: create confirming session ---
        const sessConfirmId = 'sess-n1-confirm';
        eventLog.append(Events.SESSION_START, {
            sessionId: sessConfirmId,
            nodeId: 'n1',
            phase: 'worker_confirm',
            model: { provider: 'test', id: 'worker-1' },
        });

        // Step 11: session exists → CMD_PROMPT (confirming)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.CMD_PROMPT);
        expect(events[0].payload.phase).toBe('confirming');

        // Step 11b: Engine appends SESSION_PROMPTING for confirming
        eventLog.append(Events.SESSION_PROMPTING, { sessionId: sessConfirmId, phase: 'confirming' });

        // Step 12: no new events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Simulate side effects: confirming prompt returns tool_call 'return' ---
        eventLog.append(Events.SESSION_TOOL_CALL, {
            sessionId: sessConfirmId,
            toolName: 'return',
            toolId: 'call-2',
            params: { status: 'ok', reason: 'confirmed', affected_files: [] },
        });

        // Step 13: n1 → REVIEWING
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SQUAD_NODE_STATE);
        expect(events[0].payload.status).toBe(STATUS.REVIEWING);

        // Step 14: reviewing → need reviewer model → MODEL_POOL_ACQUIRE
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.MODEL_POOL_ACQUIRE);
        expect(events[0].payload.role).toBe('reviewer');

        // --- Simulate side effects: acquire reviewer model ---
        eventLog.append(Events.MODEL_POOL_ACQUIRE, {
            slotId: 'slot-r1',
            nodeId: 'n1',
            sessionId: 'n1',
            role: 'reviewer',
        });

        // Step 15: model acquired → CMD_CREATE_SESSION
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.CMD_CREATE_SESSION);
        expect(events[0].payload.phase).toBe('reviewer');

        // Step 15b: Engine appends SESSION_CREATING for reviewer
        eventLog.append(Events.SESSION_CREATING, { nodeId: 'n1', phase: 'reviewer' });

        // Step 16: no new events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Simulate side effects: create reviewer session ---
        const sessReviewId = 'sess-n1-review';
        eventLog.append(Events.SESSION_START, {
            sessionId: sessReviewId,
            nodeId: 'n1',
            phase: 'reviewer',
            model: { provider: 'test', id: 'reviewer-1' },
        });

        // Step 17: session exists → CMD_PROMPT (reviewer)
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.CMD_PROMPT);
        expect(events[0].payload.phase).toBe('reviewer');

        // Step 17b: Engine appends SESSION_PROMPTING for reviewer
        eventLog.append(Events.SESSION_PROMPTING, { sessionId: sessReviewId, phase: 'reviewer' });

        // Step 18: no new events
        events = engineStep();
        expect(events.length).toBe(0);

        // --- Simulate side effects: reviewer returns tool_call 'return' with status 'ok' ---
        eventLog.append(Events.SESSION_TOOL_CALL, {
            sessionId: sessReviewId,
            toolName: 'return',
            toolId: 'call-3',
            params: { status: 'ok', reason: 'approved', affected_files: [] },
        });

        // Step 19: n1 → APPROVED
        events = engineStep();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe(Events.SQUAD_NODE_STATE);
        expect(events[0].payload.status).toBe(STATUS.APPROVED);

        // Step 20: model release + n2 should wake up!
        events = engineStep();
        // Expected: MODEL_POOL_RELEASE for worker slot, MODEL_POOL_RELEASE for reviewer slot
        const releaseEvents = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        expect(releaseEvents.length).toBe(2, 'Should release both worker and reviewer slots');

        // n2 should also start transitioning
        const n2Events = events.filter((e) => e.payload.nodeId === 'n2');
        // n2 was idle, now deps met (n1 approved) → authoring
        expect(n2Events.some((e) => e.payload.status === STATUS.AUTHORING)).toBe(true);
    });
});
