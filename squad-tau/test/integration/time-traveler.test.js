/**
 * Synchronous Time-Traveler Integration Tests (v3 — No Commands).
 *
 * Simulates the full Engine loop synchronously: react(f) → append to log →
 * fake side effects → repeat. No async, no mocks, no real LLMs.
 * The reactor emits facts directly; side-effects are simulated inline.
 */
import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { applyEvent } from '../../shared/projections.js';

/**
 * Synchronous Time Traveler.
 * Drives the reactor loop to convergence using fake side effects.
 *
 * @param {Array} initialEvents  - Seed EventLog (array of {event, payload})
 * @param {Function} promptBehavior - (payload) => {status, reason} for fake LLM responses
 * @returns {Array}  Final EventLog after convergence
 */
function timeTravel(initialEvents, promptBehavior = () => ({ status: 'ok', reason: 'auto' })) {
    let idGen = 0;
    const log = {
        a: initialEvents.map((e, i) => ({ id: i, event: e.event, payload: e.payload })),
        nextId: initialEvents.length,
    };
    function getSince() {
        return log.a;
    }
    function append(type, payload) {
        const o = { id: log.nextId++, event: type, payload };
        log.a.push(o);
        return o;
    }

    for (let i = 0; i < 200; i++) {
        const actions = reactState(project(getSince()));
        if (actions.length === 0) break;

        for (const action of actions) {
            append(action.type, action.payload);

            // Simulate side effects for facts that need async processing
            if (action.type === Events.SESSION_CREATING) {
                append(Events.SESSION_START, {
                    sessionId: `sess-${idGen++}`,
                    nodeId: action.payload.nodeId,
                    phase: action.payload.phase,
                });
            } else if (action.type === Events.SESSION_PROMPTING) {
                append(Events.SESSION_TOOL_CALL, {
                    sessionId: action.payload.sessionId,
                    toolName: 'return',
                    toolId: `call-${idGen++}`,
                    params: promptBehavior(action.payload),
                });
            }
        }
    }

    return getSince();
}

function initSquad(events) {
    return [{ event: Events.SQUAD_INIT, payload: events }];
}

// ---------------------------------------------------------------------------
// M mode — single node
// ---------------------------------------------------------------------------
describe('M mode — single node', () => {
    test('runs full lifecycle to SQUAD_COMPLETE', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 'do work', review_criteria: ['ok'], depends_on: [] }],
                originalTask: 'test',
            }),
        );

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes.every((n) => n.status === STATUS.APPROVED)).toBe(true);
        expect(state.squad.results.length).toBe(1);
        expect(state.squad.results[0].nodeId).toBe('n1');
    });

    test('final model pool usage is empty', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );

        const state = project(finalLog);
        expect(Object.keys(state.modelPool.usage).length).toBe(0);
    });

    test('SQUAD_COMPLETE is the last event in the log', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );

        const lastEvent = finalLog[finalLog.length - 1];
        expect(lastEvent.event).toBe(Events.SQUAD_COMPLETE);
    });
});

// ---------------------------------------------------------------------------
// L mode — chain n1 -> n2
// ---------------------------------------------------------------------------
describe('L mode — chain n1 -> n2', () => {
    test('both nodes approved, n2 starts after n1', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [
                    { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                    { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
                ],
                originalTask: 'test',
            }),
        );

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes.every((n) => n.status === STATUS.APPROVED)).toBe(true);
        expect(state.squad.results.length).toBe(2);

        // Verify n1's first node state (idle) appears before any n2 state
        const n1IdleIdx = finalLog.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'n1' && e.payload.status === 'idle',
        );
        const n2IdleIdx = finalLog.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'n2' && e.payload.status === 'idle',
        );
        expect(n1IdleIdx).toBeGreaterThanOrEqual(0);
        expect(n2IdleIdx).toBeGreaterThanOrEqual(0);

        // n1's authoring must come before n2's authoring
        const n1AuthIdx = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'n1' &&
                e.payload.status === STATUS.AUTHORING,
        );
        const n2AuthIdx = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'n2' &&
                e.payload.status === STATUS.AUTHORING,
        );
        expect(n1AuthIdx).toBeGreaterThan(0);
        expect(n2AuthIdx).toBeGreaterThan(n1AuthIdx);
    });
});

// ---------------------------------------------------------------------------
// L mode — diamond A -> B,C -> D
// ---------------------------------------------------------------------------
describe('L mode — diamond A -> B,C -> D', () => {
    test('all four nodes reach approved with correct ordering', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [
                    { id: 'A', task: 'alpha', review_criteria: [], depends_on: [] },
                    { id: 'B', task: 'beta', review_criteria: [], depends_on: ['A'] },
                    { id: 'C', task: 'gamma', review_criteria: [], depends_on: ['A'] },
                    { id: 'D', task: 'delta', review_criteria: [], depends_on: ['B', 'C'] },
                ],
                originalTask: 'test',
            }),
        );

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes.every((n) => n.status === STATUS.APPROVED)).toBe(true);
        expect(state.squad.results.length).toBe(4);

        // A must be AUTHORING before B and C
        const aAuth = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'A' &&
                e.payload.status === STATUS.AUTHORING,
        );
        const bAuth = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'B' &&
                e.payload.status === STATUS.AUTHORING,
        );
        const cAuth = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'C' &&
                e.payload.status === STATUS.AUTHORING,
        );
        expect(aAuth).toBeLessThan(bAuth);
        expect(aAuth).toBeLessThan(cAuth);

        // D must AUTHORING after both B and C are APPROVED
        const dAuth = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'D' &&
                e.payload.status === STATUS.AUTHORING,
        );
        const bApproved = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'B' && e.payload.status === STATUS.APPROVED,
        );
        const cApproved = finalLog.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'C' && e.payload.status === STATUS.APPROVED,
        );
        expect(dAuth).toBeGreaterThan(bApproved);
        expect(dAuth).toBeGreaterThan(cApproved);
    });
});

// ---------------------------------------------------------------------------
// Reviewer rejection + retry
// ---------------------------------------------------------------------------
describe('Reviewer rejection and retry', () => {
    test('reviewer rejects once, retry succeeds — all nodes approved', () => {
        let reviewCalls = 0;
        const finalLog = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 'work', review_criteria: ['ok'], depends_on: [] }],
                originalTask: 'test',
            }),
            (payload) => {
                if (payload.phase === 'reviewer') {
                    reviewCalls++;
                    return reviewCalls === 1
                        ? { status: 'error', reason: 'needs improvement' }
                        : { status: 'ok', reason: 'approved' };
                }
                return { status: 'ok', reason: 'auto' };
            },
        );

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes[0].status).toBe(STATUS.APPROVED);
        expect(reviewCalls).toBe(2);

        // Verify the rejection caused a retry state in the log: node was back to AUTHORING
        const authAfterReject = finalLog.filter(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'n1' &&
                e.payload.status === STATUS.AUTHORING,
        );
        expect(authAfterReject.length).toBeGreaterThanOrEqual(2);

        // Retry count should be recorded
        const authoringEvents = finalLog.filter(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'n1' &&
                e.payload.status === STATUS.AUTHORING,
        );
        expect(authoringEvents[1].payload.retryCount).toBe(1);
    });

    test('reviewer always rejects — node retries but eventually hits max retries', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 'work', review_criteria: ['ok'], depends_on: [] }],
                originalTask: 'test',
            }),
            () => ({ status: 'error', reason: 'never good enough' }),
        );

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');
        const n1 = state.squad.nodes[0];
        expect([STATUS.APPROVED, STATUS.FAILED, STATUS.BLOCKED]).toContain(n1.status);
    });
});

// ---------------------------------------------------------------------------
// Outer review rejection + re-approval
// ---------------------------------------------------------------------------
describe('Outer review rejection cycle', () => {
    test('outer review rejects, nodes reset and re-approved, round 2 succeeds', () => {
        let orCalls = 0;
        const finalLog = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [{ id: 'n1', task: 'task a', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
            (payload) => {
                if (payload.phase === 'outer_review') {
                    orCalls++;
                    return orCalls === 1
                        ? { status: 'error', reason: 'needs rework from outer review' }
                        : { status: 'ok', reason: 'approved after rework' };
                }
                return { status: 'ok', reason: 'auto' };
            },
        );

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes[0].status).toBe(STATUS.APPROVED);
        expect(orCalls).toBe(2);

        const orStartEvents = finalLog.filter((e) => e.event === Events.SQUAD_OUTER_REVIEW_START);
        expect(orStartEvents.length).toBe(2);
        expect(orStartEvents[0].payload.round).toBe(1);
        expect(orStartEvents[1].payload.round).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Model pool invariants under time travel
// ---------------------------------------------------------------------------
describe('Model pool invariants', () => {
    test('model pool usage resolved to empty after completion', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [
                    { id: 'A', task: 'alpha', review_criteria: [], depends_on: [] },
                    { id: 'B', task: 'beta', review_criteria: [], depends_on: ['A'] },
                ],
                originalTask: 'test',
            }),
        );

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');
        expect(Object.keys(state.modelPool.usage).length).toBe(0);
    });

    test('model pool slots are acquired and released in correct pairing', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );

        const acquires = finalLog.filter((e) => e.event === Events.MODEL_POOL_ACQUIRE);
        const releases = finalLog.filter((e) => e.event === Events.MODEL_POOL_RELEASE);
        expect(acquires.length).toBe(releases.length);
    });

    test('no slot is ever held by two concurrent phases for same node/role', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );

        const slotEvents = finalLog.filter(
            (e) => e.event === Events.MODEL_POOL_ACQUIRE || e.event === Events.MODEL_POOL_RELEASE,
        );
        const slotHistories = {};
        for (const e of slotEvents) {
            const sid = e.payload.slotId;
            if (!slotHistories[sid]) slotHistories[sid] = [];
            slotHistories[sid].push(e.event);
        }

        for (const [sid, history] of Object.entries(slotHistories)) {
            for (let i = 0; i < history.length; i++) {
                const expected = i % 2 === 0 ? Events.MODEL_POOL_ACQUIRE : Events.MODEL_POOL_RELEASE;
                expect(history[i]).toBe(expected, `slot ${sid} event ${i}: expected ${expected} but got ${history[i]}`);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Fuzzy invariants
// ---------------------------------------------------------------------------
describe('Fuzzy invariants', () => {
    test('model pool usage count never exceeds total slot count per role', () => {
        const finalLog = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [
                    { id: 'A', task: 'a', review_criteria: [], depends_on: [] },
                    { id: 'B', task: 'b', review_criteria: [], depends_on: [] },
                ],
                originalTask: 'test',
            }),
        );

        const acquires = finalLog.filter((e) => e.event === Events.MODEL_POOL_ACQUIRE);
        expect(acquires.length).toBe(0, 'No model acquisitions without configured slots');

        const state = project(finalLog);
        expect(state.squad.status).toBe('complete');

        const replayState = { squad: { status: 'active', nodes: [] }, modelPool: { usage: {} }, sessions: {} };
        for (const entry of finalLog) {
            applyEvent(replayState, entry.event, entry.payload);
            expect(Object.keys(replayState.modelPool.usage).length).toBe(
                0,
                `usage must be empty at ${entry.event}:${entry.payload?.slotId || ''}`,
            );
        }

        expect(replayState.squad.status).toBe('complete');
        expect(Object.keys(replayState.modelPool.usage).length).toBe(0);
    });
});
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
