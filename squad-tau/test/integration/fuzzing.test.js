/**
 * Algebraic Fuzzing — Statistical Invariant Verification (v4).
 *
 * A) Structural Fuzzing: generate garbage events, ONLY assert no crash.
 * B) Behavioral Fuzzing (TimeTraveler-driven): assert business causality.
 *
 * Adapted for v4: flat node map, no modelPool.usage, deterministic URNs.
 */
import { describe, test, expect } from 'bun:test';
import { project, applyEvent, getInitialState } from '../../shared/projections.js';
import { reactState } from '../../server/reactor.js';
import { Events } from '../../shared/events.js';
import { timeTravel } from '../helpers/engine-simulator.js';

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const ALL_EVENT_TYPES = Object.values(Events).filter(
    (t) => !t.startsWith('session:message_delta') && !t.startsWith('session:thinking_delta'),
);
const NODE_STATUSES = [
    'waiting_deps',
    'pending',
    'authoring',
    'confirming',
    'reviewing',
    'approved',
    'rejected',
    'blocked',
    'failed',
];

function assertConvergedInvariants(state) {
    // DAG barrier
    for (const node of Object.values(state.squad.nodes || {})) {
        if (node.status !== 'approved') continue;
        for (const depId of node.depends_on || []) {
            const dep = state.squad.nodes[depId];
            if (dep) expect(dep.status).toBe('approved');
        }
    }
}

// ======================================================================
// A) Structural Fuzzing
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
                            phase: pick(['authoring', 'reviewing']),
                        };
                    case Events.SESSION_CREATING:
                        return {
                            sessionId: `s-${randInt(0, 999)}`,
                            nodeId: `n${randInt(0, 20)}`,
                            phase: pick(['authoring', 'reviewing']),
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
                    case Events.MODEL_POOL_CONFIG_UPDATE:
                        return {
                            action: 'add',
                            slot: { provider: 'test', modelId: 'm', role: 'worker', slotId: `s-${i}` },
                        };
                    default:
                        return {};
                }
            })();

            try {
                applyEvent(state, et, payload);
            } catch {
                /* expected for edge cases */
            }

            if (i % 100 === 0) {
                try {
                    const actions = reactState(state);
                    expect(Array.isArray(actions)).toBe(true);
                } catch (e) {
                    expect().fail(`reactState threw at iteration ${i}: ${e.message}`);
                }
            }
        }

        const actions = reactState(state);
        expect(Array.isArray(actions)).toBe(true);
    });

    test('all event types with null/missing payloads — reactState stable', () => {
        for (const type of ALL_EVENT_TYPES) {
            const state = getInitialState();
            for (const payload of [null, {}, undefined, { randomKey: true }]) {
                try {
                    applyEvent(state, type, payload);
                } catch {
                    /* expected */
                }
            }
            expect(() => reactState(state)).not.toThrow();
        }
    });
});

// ======================================================================
// B) Behavioral Fuzzing — via TimeTraveler
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
        expect(state.squad.nodes['n1'].status).toBe('approved');
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
        expect(Object.values(state.squad.nodes).every((n) => n.status === 'approved')).toBe(true);

        const aAuth = log.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'A' && e.payload.status === 'authoring',
        );
        const bAuth = log.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'B' && e.payload.status === 'authoring',
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
        expect(Object.values(state.squad.nodes).every((n) => n.status === 'approved')).toBe(true);
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
                if (payload.phase === 'reviewing') {
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
        expect(state.squad.nodes['n1'].status).toBe('approved');
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
        const n1 = state.squad.nodes['n1'];
        expect(n1.status).toBe('failed');
        expect(n1.retryCount).toBeGreaterThanOrEqual(5 - 1);
        assertConvergedInvariants(state);
    });
});

// ======================================================================
// C) Edge case pressure
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
});
