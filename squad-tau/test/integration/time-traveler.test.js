import { describe, test, expect } from 'bun:test';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';
import { timeTravel, initSquad } from '../helpers/engine-simulator.js';

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
        expect(log[log.length - 1].event).toBe(Events.SQUAD_COMPLETE);
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
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'n1' && e.payload.status === 'authoring',
        );
        const n2a = log.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'n2' && e.payload.status === 'authoring',
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
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'A' && e.payload.status === 'authoring',
        );
        const bA = log.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'B' && e.payload.status === 'authoring',
        );
        const dA = log.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'D' && e.payload.status === 'authoring',
        );
        expect(bA).toBeGreaterThan(aA);
        const bAp = log.findIndex(
            (e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'B' && e.payload.status === 'approved',
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

describe('outer review rejection cycle', () => {
    test('reject then approve round 2', () => {
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
                    return calls === 1 ? { status: 'error', reason: 'rework' } : { status: 'ok', reason: 'ok' };
                }
                return { status: 'ok', reason: 'auto' };
            },
        );
        const state = project(log);
        expect(state.squad.status).toBe('complete');
        expect(state.squad.nodes['n1'].status).toBe('approved');
        expect(log.filter((e) => e.event === Events.SQUAD_OUTER_REVIEW_START).length).toBe(2);
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
        expect(log.filter((e) => e.event === Events.MODEL_POOL_ACQUIRE).length).toBe(0);
        expect(log.filter((e) => e.event === Events.MODEL_POOL_RELEASE).length).toBe(0);
    });

    test('SESSION_CREATING has deterministic sessionId', () => {
        const log = timeTravel(
            initSquad({
                mode: 'M',
                nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
                originalTask: 'test',
            }),
        );
        for (const c of log.filter((e) => e.event === Events.SESSION_CREATING)) {
            expect(c.payload.sessionId).toMatch(/^.+::.+::\d+$/);
        }
    });
});
