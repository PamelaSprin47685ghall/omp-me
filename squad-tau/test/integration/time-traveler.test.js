import { describe, test, expect } from 'bun:test';
import { project } from '../../shared/projections.js';
import { timeTravel, initSquad } from '../helpers/engine-simulator.js';
import { EventLog } from '../../server/event-log.js';

function firstNode(state) {
    return Object.values(state.squad.nodes)[0];
}

describe('M mode — single node', () => {
    test('runs full lifecycle to SQUAD_COMPLETE', () => {
        const log = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: ['ok'], depends_on: [] }],
                originalTask: 'test',
            }),
        );
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(Object.values(state.squad.nodes).every((n) => n.status === 'approved')).toBe(true);
        expect(state.squad.results.length).toBe(1);
    });

    test('SQUAD_COMPLETE is the last event', () => {
        const log = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );
        expect(log[log.length - 1].event).toBe('squad:complete');
    });
});

describe('L mode — chain', () => {
    test('n2 starts after n1', () => {
        const log = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [
                    { id: 'n1', task: 'a', review_criteria: [], depends_on: [] },
                    { id: 'n2', task: 'b', review_criteria: [], depends_on: ['n1'] },
                ],
                originalTask: 'test',
            }),
        );
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(Object.values(state.squad.nodes).every((n) => n.status === 'approved')).toBe(true);
        const n1a = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'n1' && e.payload.status === 'authoring',
        );
        const n2a = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'n2' && e.payload.status === 'authoring',
        );
        expect(n2a).toBeGreaterThan(n1a);
    });
});

describe('diamond A -> B,C -> D', () => {
    test('all four approved with ordering', () => {
        const log = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [
                    { id: 'A', task: 'a', depends_on: [] },
                    { id: 'B', task: 'b', depends_on: ['A'] },
                    { id: 'C', task: 'c', depends_on: ['A'] },
                    { id: 'D', task: 'd', depends_on: ['B', 'C'] },
                ],
                originalTask: 'test',
            }),
        );
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(Object.values(state.squad.nodes).every((n) => n.status === 'approved')).toBe(true);
        const aA = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'A' && e.payload.status === 'authoring',
        );
        const bA = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'B' && e.payload.status === 'authoring',
        );
        const dA = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'D' && e.payload.status === 'authoring',
        );
        expect(bA).toBeGreaterThan(aA);
        const bAp = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'B' && e.payload.status === 'approved',
        );
        expect(dA).toBeGreaterThan(bAp);
    });
});

describe('retry', () => {
    test('reviewer rejects once then succeeds', () => {
        let calls = 0;
        const log = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 'work', review_criteria: ['ok'], depends_on: [] }],
                originalTask: 'test',
            }),
            (p) => {
                if (p.phase === 'reviewing') {
                    calls++;
                    return calls === 1 ? { status: 'error', reason: 'fix' } : { status: 'ok', reason: 'ok' };
                }
                return { status: 'ok', reason: 'auto' };
            },
        );
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(firstNode(state).status).toBe('approved');
        expect(calls).toBe(2);
    });

    test('always reject eventually exhausts retries', () => {
        const log = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 'work', review_criteria: ['ok'], depends_on: [] }],
                originalTask: 'test',
            }),
            () => ({ status: 'error', reason: 'no' }),
        );
        expect(project(log).squad.status).toBe('complete');
    });
});

describe('outer review rejection → architect awakening', () => {
    test('rejection freezes DAG with phase_changed', () => {
        let calls = 0;
        const log = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [{ id: 'n1', task: 'a', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
            (p) => {
                if (p.phase === 'outer_review') {
                    calls++;
                    return { status: 'error', reason: 'needs fundamental redesign' };
                }
                return { status: 'ok', reason: 'auto' };
            },
        );

        // After outer review rejection, the DAG should freeze with phase_changed
        const phaseChanged = log.find((e) => e.event === 'squad:phase_changed');
        expect(phaseChanged).toBeDefined();
        expect(phaseChanged.payload.phase).toBe('revising');
        expect(phaseChanged.payload.feedback).toBe('needs fundamental redesign');

        // No more __or__ sessions should be created after rejection
        const orSessions = log.filter((e) => e.event === 'session:creating' && e.payload.nodeId === '__or__');
        // Only the one session for the outer review that was created
        expect(orSessions.length).toBe(1);

        // The state should be stuck in 'revising' — squad is NOT complete
        const state = project(log);
        expect(state.squad.status).toBe('active');
        expect(state.squad.phase).toBe('revising');
    });

    test('squad:replan unfreezes the DAG for a new cycle', () => {
        // Simulate: first cycle where outer review rejects
        const log1 = timeTravel(
            initSquad({
                mode: 'L',
                nodes: [{ id: 'n1', task: 'a', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
            (p) => {
                if (p.phase === 'outer_review') {
                    return { status: 'error', reason: 'redesign' };
                }
                return { status: 'ok', reason: 'auto' };
            },
        );

        const state1 = project(log1);
        expect(state1.squad.phase).toBe('revising');

        // Now simulate agent calling delegate again → squad:replan
        const eventLog2 = new EventLog(log1);
        eventLog2.append('squad:replan', {
            mode: 'M',
            nodes: [
                {
                    id: 'n2',
                    task: 'redesigned approach',
                    review_criteria: ['quality'],
                    depends_on: [],
                },
            ],
            originalTask: 'test',
        });

        const state2 = project(eventLog2.log);
        expect(state2.squad.status).toBe('active');
        expect(state2.squad.phase).toBe(undefined);
        expect(state2.squad.nodes.n1).toBeUndefined(); // old node gone
        expect(state2.squad.nodes.n2).toBeDefined(); // new node present
        expect(state2.squad.nodes.n2.status).toBe('authoring'); // fresh start
    });
});

describe('concurrency invariants', () => {
    test('no MODEL_POOL_ACQUIRE/RELEASE events', () => {
        const log = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );
        expect(log.filter((e) => e.event === 'model_pool:acquire').length).toBe(0);
        expect(log.filter((e) => e.event === 'model_pool:release').length).toBe(0);
    });

    test('SESSION_CREATING has deterministic sessionId', () => {
        const log = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );
        for (const c of log.filter((e) => e.event === 'session:creating')) {
            expect(c.payload.sessionId).toMatch(/^.+::.+::v\d+$/);
        }
    });
});
