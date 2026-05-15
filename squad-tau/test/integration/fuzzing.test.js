/**
 * Algebraic Fuzzing — Statistical Invariant Verification (v6).
 *
 * A) Structural Fuzzing: generate garbage events, ONLY assert no crash.
 * B) Behavioral Fuzzing (TimeTraveler-driven): assert business causality.
 *
 * v6: Domain events only, invariant-driven.
 */
import { describe, test, expect } from 'bun:test';
import { project, applyEvent, getInitialState } from '../../shared/projections.js';
import { reactState } from '../../server/reactor.js';
import { timeTravel } from '../helpers/engine-simulator.js';

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const ALL_EVENT_TYPES = [
    'squad:init',
    'squad:node_state',
    'squad:complete',
    'squad:abort',
    'session:creating',
    'session:start',
    'session:state',
    'session:end',
    'session:prompting',
    'message:created',
    'message:finalized',
    'tool_call:started',
    'tool_call:finished',
];
const NODE_STATUSES = ['idle', 'authoring', 'confirming', 'reviewing', 'approved', 'rejected', 'blocked', 'failed'];

function assertConvergedInvariants(state) {
    for (const node of Object.values(state.squad.nodes || {})) {
        if (node.status !== 'approved') continue;
        for (const depId of node.depends_on || []) {
            const dep = state.squad.nodes[depId];
            if (dep) expect(dep.status).toBe('approved');
        }
    }
}

describe('Structural Fuzzing (crash resistance)', () => {
    test('reactState never throws after random structurally-valid events', () => {
        const state = getInitialState();
        for (let i = 0; i < 500; i++) {
            const et = pick(ALL_EVENT_TYPES);
            const payload = (() => {
                switch (et) {
                    case 'squad:init':
                        return { mode: pick(['M', 'L']), nodes: [], originalTask: '' };
                    case 'squad:node_state':
                        return { nodeId: `n${randInt(0, 20)}`, status: pick(NODE_STATUSES) };
                    case 'squad:complete':
                        return { results: [] };
                    case 'squad:abort':
                        return { reason: 'fuzz' };
                    case 'session:creating':
                        return {
                            sessionId: `s-${randInt(0, 999)}`,
                            nodeId: `n${randInt(0, 20)}`,
                            phase: pick(['authoring', 'reviewing']),
                            retryCount: 0,
                        };
                    case 'session:start':
                        return {
                            sessionId: `s-${randInt(0, 999)}`,
                            nodeId: `n${randInt(0, 20)}`,
                            phase: pick(['authoring', 'reviewing']),
                            retryCount: 0,
                            model: undefined,
                        };
                    case 'session:state':
                        return { sessionId: `s-${randInt(0, 999)}`, phase: pick(['completed', 'aborted', 'error']) };
                    case 'session:end':
                        return { sessionId: `s-${randInt(0, 999)}`, reason: pick(['completed', 'aborted', 'error']) };
                    case 'session:prompting':
                        return { sessionId: `s-${randInt(0, 999)}`, phase: 'authoring' };
                    case 'message:created':
                        return {
                            messageId: `m-${i}`,
                            sessionId: `s-${randInt(0, 999)}`,
                            role: pick(['user', 'assistant']),
                        };
                    case 'message:finalized':
                        return { messageId: `m-${i}`, staticContent: 'fuzz' };
                    case 'tool_call:started':
                        return {
                            sessionId: `s-${randInt(0, 999)}`,
                            toolName: 'return',
                            toolId: `c-${i}`,
                            params: { status: 'ok' },
                        };
                    case 'tool_call:finished':
                        return { toolId: `c-${i}`, result: {}, isError: false };
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

describe('Behavioral Fuzzing (causal invariants via TimeTraveler)', () => {
    test('M mode converges to SQUAD_COMPLETE', () => {
        const log = timeTravel([
            {
                event: 'squad:init',
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
                event: 'squad:init',
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
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'A' && e.payload.status === 'authoring',
        );
        const bAuth = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'B' && e.payload.status === 'authoring',
        );
        expect(aAuth).toBeLessThan(bAuth);
        assertConvergedInvariants(state);
    });

    test('diamond converges — A -> B,C -> D', () => {
        const log = timeTravel([
            {
                event: 'squad:init',
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
                    event: 'squad:init',
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
                    event: 'squad:init',
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
        expect(n1.epoch).toBeGreaterThanOrEqual(5 - 1);
        assertConvergedInvariants(state);
    });
});

describe('Edge pressure tests', () => {
    test('100 consecutive aborts — no explosion', () => {
        const state = getInitialState();
        applyEvent(state, 'squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
            originalTask: 't',
        });
        for (let i = 0; i < 100; i++) {
            applyEvent(state, 'squad:abort', { reason: `abort-${i}` });
        }
        const actions = reactState(state);
        expect(Array.isArray(actions)).toBe(true);
        expect(actions.length).toBe(0);
    });
});
