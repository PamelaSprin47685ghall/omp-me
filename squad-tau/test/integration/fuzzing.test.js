/**
 * Algebraic Fuzzing — Statistical Invariant Verification (v2).
 *
 * Split into two orthogonal categories:
 *
 * A) Structural Fuzzing: generate garbage events, ONLY assert no crash.
 *    applyEvent may legitimately throw on garbage input — that's expected.
 *    The invariant is: reactState never throws, regardless of state content.
 *
 * B) Behavioral Fuzzing (TimeTraveler-driven):
 *    Generate only EXTERNAL inputs (user messages, tool calls, abort, model config).
 *    Run through the Reactor while loop — let the engine derive internal
 *    state transitions. Assert business causality invariants on the result.
 *
 * No browser. No WS. No mocks. Pure algebra.
 */
import { describe, test, expect } from 'bun:test';
import { project, applyEvent, getInitialState } from '../../shared/projections.js';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { STATUS, DEFAULTS } from '../../server/constants.js';

// ── Helpers ──

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randBool() {
    return Math.random() < 0.5;
}

const ALL_EVENT_TYPES = Object.values(Events).filter(
    (t) => !t.startsWith('session:message_delta') && !t.startsWith('session:thinking_delta'),
);

const NODE_STATUSES = Object.values(STATUS);

// ── Invariant Checks ──

/**
 * Count ONLY in-use slots that are known to the configuration.
 * Ghost slots (random garbage that was written to usage but doesn't
 * exist in slots) are excluded — they are memory of past configs.
 */
function countKnownInUse(usage, slots, role) {
    const knownSlotIds = new Set(slots.filter((s) => s.role === role).map((s) => s.slotId));
    return Object.entries(usage).filter(([sid, u]) => u.role === role && u.inUse && knownSlotIds.has(sid)).length;
}

function checkModelPoolInvariants(state, errors) {
    const usage = state.modelPool?.usage || {};
    const slots = state.modelPool?.slots || [];

    // Invariant: inUse count for known slots per role ≤ slot count per role
    for (const role of ['worker', 'reviewer']) {
        const roleSlots = slots.filter((s) => s.role === role);
        const knownInUse = countKnownInUse(usage, slots, role);
        if (knownInUse > roleSlots.length) {
            errors.push(`Overcommit: ${knownInUse} known ${role} inUse, but only ${roleSlots.length} slots`);
        }
    }

    // Each usage entry must have valid inUse boolean
    for (const [slotId, u] of Object.entries(usage)) {
        if (typeof u.inUse !== 'boolean') {
            errors.push(`Non-boolean inUse for ${slotId}`);
        }
    }
}

/**
 * DAG invariants only apply when state was derived by the Reactor.
 * Static seeds injected by fuzzer may violate causality — that's expected
 * for structural fuzzing. These checks are only meaningful after Reactor
 * has converged in a TimeTraveler loop.
 */
function checkDAGInvariants(state, errors) {
    const { nodes } = state.squad;
    for (const node of nodes) {
        if (node.status !== STATUS.APPROVED) continue;
        const deps = node.depends_on || [];
        for (const depId of deps) {
            const dep = nodes.find((n) => n.id === depId);
            if (dep && (dep.status === STATUS.FAILED || dep.status === STATUS.BLOCKED)) {
                errors.push(`DAG barrier broken: ${node.id} APPROVED but dep ${depId} is ${dep?.status}`);
            }
        }
    }
}

function checkReactorInvariants(state, errors) {
    try {
        const actions = reactState(state);
        if (!Array.isArray(actions)) {
            errors.push('reactState did not return an array');
            return;
        }
        // No duplicate MODEL_POOL_RELEASE for same slot in same pulse
        const releasedInBatch = new Set();
        for (const a of actions) {
            if (a.type === Events.MODEL_POOL_RELEASE) {
                if (releasedInBatch.has(a.payload.slotId)) {
                    errors.push(`Duplicate MODEL_POOL_RELEASE for slot ${a.payload.slotId} in same reactor pulse`);
                }
                releasedInBatch.add(a.payload.slotId);
            }
        }
    } catch (e) {
        errors.push(`reactState threw: ${e.message}`);
    }
}

/**
 * Invariant suite that permits ghost/phantom entries.
 * run AFTER reactor convergence — the reactor generates clean,
 * causality-compliant state transitions.
 */
function assertConvergedInvariants(state) {
    // Model pool: known slots never overcommitted
    const mp = state.modelPool || {};
    for (const role of ['worker', 'reviewer']) {
        const roleSlots = (mp.slots || []).filter((s) => s.role === role);
        const knownInUse = countKnownInUse(mp.usage || {}, mp.slots || [], role);
        expect(knownInUse).toBeLessThanOrEqual(roleSlots.length);
    }

    // DAG barrier
    for (const node of state.squad.nodes || []) {
        if (node.status !== STATUS.APPROVED) continue;
        for (const depId of node.depends_on || []) {
            const dep = state.squad.nodes.find((n) => n.id === depId);
            if (dep) expect(dep.status).toBe(STATUS.APPROVED);
        }
    }

    // All model pool usage resolved to empty at completion
    if (state.squad.status === 'complete') {
        expect(Object.keys(mp.usage || {}).length).toBe(0);
    }
}

// ── Synchronous TimeTraveler (lightweight) ──

function timeTravel(seedEvents, promptBehavior = () => ({ status: 'ok', reason: 'auto' })) {
    let idGen = 0;
    const log = {
        a: seedEvents.map((e, i) => ({ id: i, event: e.event || e.type, payload: e.payload })),
        nextId: seedEvents.length,
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
        const cmds = reactState(project(getSince()));
        if (cmds.length === 0) break;

        for (const cmd of cmds) {
            append(cmd.type, cmd.payload);

            switch (cmd.type) {
                case Events.CMD_CREATE_SESSION:
                    append(Events.SESSION_START, {
                        sessionId: `sess-${idGen++}`,
                        nodeId: cmd.payload.nodeId,
                        phase: cmd.payload.phase,
                    });
                    break;
                case Events.CMD_PROMPT:
                    append(Events.SESSION_TOOL_CALL, {
                        sessionId: cmd.payload.sessionId,
                        toolName: 'return',
                        toolId: `call-${idGen++}`,
                        params: promptBehavior(cmd.payload),
                    });
                    break;
            }
        }
    }

    return log.a;
}

// ======================================================================
// A) Structural Fuzzing — garbage resistance
// ======================================================================
describe('Structural Fuzzing (crash resistance)', () => {
    test('reactState never throws after random structurally-valid events', () => {
        const state = getInitialState();
        for (let i = 0; i < 500; i++) {
            const et = pick(ALL_EVENT_TYPES);
            const payload = (() => {
                switch (et) {
                    case Events.SQUAD_INIT:
                        return { mode: pick(['M', 'L']), nodes: [], originalTask: '' };
                    case Events.SQUAD_NODE_STATE:
                        return { nodeId: `n${randInt(0, 20)}`, status: pick(NODE_STATUSES.concat(['idle'])) };
                    case Events.SQUAD_COMPLETE:
                        return { results: [] };
                    case Events.SQUAD_ABORT:
                        return { reason: 'fuzz' };
                    case Events.SESSION_START:
                        return {
                            sessionId: `s-${randInt(0, 999)}`,
                            nodeId: `n${randInt(0, 20)}`,
                            phase: pick(['worker', 'reviewer']),
                        };
                    case Events.SESSION_STATE:
                        return { sessionId: `s-${randInt(0, 999)}`, phase: pick(['completed', 'aborted', 'error']) };
                    case Events.SESSION_END:
                        return { sessionId: `s-${randInt(0, 999)}`, reason: pick(['completed', 'aborted', 'error']) };
                    case Events.SESSION_MESSAGE:
                        return {
                            sessionId: `s-${randInt(0, 999)}`,
                            role: 'user',
                            content: [{ type: 'text', text: 'fuzz' }],
                            messageId: `m-${i}`,
                        };
                    case Events.SESSION_TOOL_CALL:
                        return {
                            sessionId: `s-${randInt(0, 999)}`,
                            toolName: 'return',
                            toolId: `c-${i}`,
                            params: { status: 'ok' },
                        };
                    case Events.SESSION_TOOL_RESULT:
                        return { sessionId: `s-${randInt(0, 999)}`, toolId: `c-${i}`, result: {}, isError: false };
                    case Events.MODEL_POOL_SNAPSHOT:
                        return { slots: [] };
                    case Events.MODEL_POOL_ACQUIRE:
                        return {
                            slotId: `slot-${randInt(0, 9)}`,
                            nodeId: `n${randInt(0, 20)}`,
                            sessionId: `s-${i}`,
                            role: pick(['worker', 'reviewer']),
                        };
                    case Events.MODEL_POOL_RELEASE:
                        return { slotId: `slot-${randInt(0, 9)}` };
                    default:
                        return {};
                }
            })();

            try {
                applyEvent(state, et, payload);
            } catch {
                // applyEvent may throw on edge cases (e.g., SQUAD_INIT with empty nodes).
                // This is acceptable — projection expects valid data.
                // The invariant is reactState stability, not applyEvent stability.
            }

            if (i % 100 === 0) {
                checkReactorInvariants(state, []);
            }
        }

        // Final: reactState must never throw
        const errors = [];
        checkReactorInvariants(state, errors);
        expect(errors).toEqual([]);
    });

    test('all event types with null/missing payloads — reactState stable', () => {
        for (const type of ALL_EVENT_TYPES) {
            const state = getInitialState();
            // Try feeding malformed payloads; applyEvent may throw, that's fine.
            for (const payload of [null, {}, undefined, { randomKey: true }]) {
                try {
                    applyEvent(state, type, payload);
                } catch {
                    /* expected */
                }
            }

            let threw = false;
            try {
                reactState(state);
            } catch {
                threw = true;
            }
            expect(threw).toBe(false, `reactState threw for event type ${type}`);
        }
    });
});

// ======================================================================
// B) Behavioral Fuzzing — causality-driven, via TimeTraveler
// ======================================================================
describe('Behavioral Fuzzing (causal invariants via TimeTraveler)', () => {
    test('M mode converges to SQUAD_COMPLETE', () => {
        const log = timeTravel([
            {
                event: Events.SQUAD_INIT,
                payload: {
                    mode: 'M',
                    nodes: [{ id: 'n1', task: 't', review_criteria: ['ok'], depends_on: [] }],
                    originalTask: 't',
                },
            },
        ]);
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes[0].status).toBe(STATUS.APPROVED);
        assertConvergedInvariants(state);
    });

    test('L chain converges — both nodes approved with ordering', () => {
        const log = timeTravel([
            {
                event: Events.SQUAD_INIT,
                payload: {
                    mode: 'L',
                    nodes: [
                        { id: 'A', task: 'first', review_criteria: [], depends_on: [] },
                        { id: 'B', task: 'second', review_criteria: [], depends_on: ['A'] },
                    ],
                    originalTask: 't',
                },
            },
        ]);
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes.every((n) => n.status === STATUS.APPROVED)).toBe(true);

        // A authored before B
        const aAuth = log.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'A' &&
                e.payload.status === STATUS.AUTHORING,
        );
        const bAuth = log.findIndex(
            (e) =>
                e.event === Events.SQUAD_NODE_STATE &&
                e.payload.nodeId === 'B' &&
                e.payload.status === STATUS.AUTHORING,
        );
        expect(aAuth).toBeLessThan(bAuth);
        assertConvergedInvariants(state);
    });

    test('diamond converges — A -> B,C -> D', () => {
        const log = timeTravel([
            {
                event: Events.SQUAD_INIT,
                payload: {
                    mode: 'L',
                    nodes: [
                        { id: 'A', task: 'alpha', review_criteria: [], depends_on: [] },
                        { id: 'B', task: 'beta', review_criteria: [], depends_on: ['A'] },
                        { id: 'C', task: 'gamma', review_criteria: [], depends_on: ['A'] },
                        { id: 'D', task: 'delta', review_criteria: [], depends_on: ['B', 'C'] },
                    ],
                    originalTask: 't',
                },
            },
        ]);
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes.every((n) => n.status === STATUS.APPROVED)).toBe(true);
        assertConvergedInvariants(state);
    });

    test('reviewer rejection causes retry, final approval', () => {
        let reviewCalls = 0;
        const log = timeTravel(
            [
                {
                    event: Events.SQUAD_INIT,
                    payload: {
                        mode: 'M',
                        nodes: [{ id: 'n1', task: 't', review_criteria: ['ok'], depends_on: [] }],
                        originalTask: 't',
                    },
                },
            ],
            (payload) => {
                if (payload.phase === 'reviewer') {
                    reviewCalls++;
                    return reviewCalls === 1
                        ? { status: 'error', reason: 'fix it' }
                        : { status: 'ok', reason: 'approved' };
                }
                return { status: 'ok', reason: 'auto' };
            },
        );
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes[0].status).toBe(STATUS.APPROVED);
        expect(reviewCalls).toBe(2);
        assertConvergedInvariants(state);
    });

    test('MAX_RETRIES rejections lead to FAILED', () => {
        let callCount = 0;
        const log = timeTravel(
            [
                {
                    event: Events.SQUAD_INIT,
                    payload: {
                        mode: 'M',
                        nodes: [{ id: 'n1', task: 't', review_criteria: ['ok'], depends_on: [] }],
                        originalTask: 't',
                    },
                },
            ],
            () => {
                callCount++;
                return { status: 'error', reason: 'nope' };
            },
        );
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        const n1 = state.squad.nodes[0];
        expect(n1.status).toBe(STATUS.FAILED);
        // The node should have hit MAX_RETRIES (retryCount on node reflects last AUTHORING retry, before FAILED)
        expect(n1.retryCount).toBeGreaterThanOrEqual(DEFAULTS.MAX_RETRIES - 1);
        assertConvergedInvariants(state);
    });

    test('model pool usage resolved to empty after completion', () => {
        const log = timeTravel([
            {
                event: Events.SQUAD_INIT,
                payload: {
                    mode: 'M',
                    nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                    originalTask: 't',
                },
            },
        ]);
        const state = project(log);
        expect(Object.keys(state.modelPool.usage).length).toBe(0);
    });
});

// ======================================================================
// C) Edge case pressure — direct state manipulation
// ======================================================================
describe('Edge pressure tests', () => {
    test('100 consecutive aborts — no explosion', () => {
        const state = getInitialState();
        applyEvent(state, Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
            originalTask: 't',
        });
        for (let i = 0; i < 100; i++) {
            applyEvent(state, Events.SQUAD_ABORT, { reason: `abort-${i}` });
        }
        const actions = reactState(state);
        expect(Array.isArray(actions)).toBe(true);
        expect(actions.length).toBe(0);
    });

    test('model pool acquire/release storm — invariants hold', () => {
        const state = getInitialState();
        applyEvent(state, Events.MODEL_POOL_SNAPSHOT, {
            slots: [
                { slotId: 's1', provider: 'test', modelId: 'm1', role: 'worker' },
                { slotId: 's2', provider: 'test', modelId: 'm2', role: 'worker' },
            ],
        });
        for (let i = 0; i < 200; i++) {
            const role = pick(['worker', 'reviewer']);
            applyEvent(state, Events.MODEL_POOL_ACQUIRE, {
                slotId: role === 'worker' ? `s${randInt(1, 2)}` : 's3',
                nodeId: `n${randInt(1, 5)}`,
                sessionId: `sess-${i}`,
                role,
            });
        }
        const errors = [];
        checkModelPoolInvariants(state, errors);
        expect(errors).toEqual([]);

        // Reactor must not throw despite potential overcommit ghost entries
        checkReactorInvariants(state, errors);
        expect(errors).toEqual([]);
    });
});
