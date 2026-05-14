/**
 * Orthogonal unit tests for individual reactor behaviors.
 * Tests the EXACT condition transitions — proving/disproving specific hypotheses.
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';
import { STATUS } from '../../server/constants.js';
import { buildState, nodeInPhase, addReturn } from '../helpers/state-builder.js';

const MAX_RETRIES = 5;

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
        last() {
            return a[a.length - 1];
        },
    };
}

describe('nodeHistory scoping', () => {
    test('confirming phase does NOT see authoring-phase MODEL_POOL_ACQUIRE in scoped nodeHistory', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
            originalTask: 't',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
        l.append(Events.SESSION_START, { sessionId: 'ws', nodeId: 'n1', phase: 'worker' });
        l.append(Events.SESSION_TOOL_CALL, { sessionId: 'ws', toolName: 'return', params: { status: 'ok' } });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.CONFIRMING });

        const all = l.all();
        const lastStatusChange = [...all]
            .reverse()
            .find((e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'n1');
        expect(lastStatusChange.payload.status).toBe(STATUS.CONFIRMING);

        const nodeHistory = all.filter((e) => {
            const isRelevant =
                e.payload?.nodeId === 'n1' ||
                (e.payload?.sessionId && [].some((s) => s.sessionId === e.payload.sessionId));
            return isRelevant && (!lastStatusChange || e.id >= lastStatusChange.id);
        });

        const modelAcquired = nodeHistory.find(
            (e) => e.event === Events.MODEL_POOL_ACQUIRE && e.payload.role === 'worker',
        );
        expect(modelAcquired).toBeUndefined(
            'nodeHistory (scoped) should NOT find MODEL_POOL_ACQUIRE from authoring phase',
        );

        const modelAcquiredFull = all.find(
            (e) => e.event === Events.MODEL_POOL_ACQUIRE && e.payload.role === 'worker' && e.payload.nodeId === 'n1',
        );
        expect(modelAcquiredFull).toBeDefined('fullLog should find MODEL_POOL_ACQUIRE from authoring phase');
        expect(modelAcquiredFull.payload.slotId).toBe('s1');
    });
});

describe('MODEL_POOL_ACQUIRE nodeId field', () => {
    test('acquire event stores nodeId correctly', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'node1', task: 't', review_criteria: [] }],
            originalTask: 't',
        });
        l.append(Events.MODEL_POOL_ACQUIRE, {
            slotId: 'slot-0-worker-test-w1',
            nodeId: 'node1',
            sessionId: 'node1',
            role: 'worker',
        });

        const all = l.all();
        const acquire = all.find((e) => e.event === Events.MODEL_POOL_ACQUIRE);
        expect(acquire.payload.nodeId).toBe('node1');
        expect(acquire.payload.role).toBe('worker');
        expect(acquire.payload.slotId).toBe('slot-0-worker-test-w1');
    });
});

describe('hasPendingCommand with fullLog vs nodeHistory', () => {
    test('MODEL_POOL_ACQUIRE from authoring phase is found in fullLog during confirming', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [{ id: 'n1', task: 't', review_criteria: [], depends_on: [] }],
            originalTask: 't',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.MODEL_POOL_ACQUIRE, { nodeId: 'n1', role: 'worker', phase: 'worker' });
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
        l.append(Events.SESSION_START, { sessionId: 'sess1', nodeId: 'n1', phase: 'worker' });
        l.append(Events.SESSION_TOOL_CALL, { sessionId: 'sess1', toolName: 'return', params: { status: 'ok' } });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.CONFIRMING });

        const all = l.all();
        const lastSC = [...all].reverse().find((e) => e.event === Events.SQUAD_NODE_STATE && e.payload.nodeId === 'n1');
        const nHistory = all.filter((e) => {
            const r =
                e.payload?.nodeId === 'n1' ||
                (e.payload?.sessionId && [].some((s) => s.sessionId === e.payload.sessionId));
            return r && (!lastSC || e.id >= lastSC.id);
        });

        // With fullLog: should find authoring's MODEL_POOL_ACQUIRE
        const pendingFull = all.some((e) => e.event === Events.MODEL_POOL_ACQUIRE && e.payload.role === 'worker');
        expect(pendingFull).toBe(true);

        // With nodeHistory (scoped): should NOT find it
        const pendingScoped = nHistory.some(
            (e) => e.event === Events.MODEL_POOL_ACQUIRE && e.payload.role === 'worker',
        );
        expect(pendingScoped).toBe(false);

        // CMD_CREATE_SESSION for confirming phase (phase:'worker_confirm') should NOT exist
        const createPendingFull = all.some(
            (e) => e.event === Events.CMD_CREATE_SESSION && e.payload.phase === 'worker_confirm',
        );
        expect(createPendingFull).toBe(false);
    });
});

describe('reactor model release rule', () => {
    test('releases models when node is APPROVED', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
            originalTask: 't',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
        l.append(Events.SESSION_START, { sessionId: 's1s', nodeId: 'n1', phase: 'worker' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.CONFIRMING });
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's2', nodeId: 'n1', sessionId: 'n1', role: 'reviewer' });
        l.append(Events.SESSION_START, { sessionId: 's2s', nodeId: 'n1', phase: 'reviewer' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.REVIEWING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });
        l.append('model_pool:snapshot', {
            slots: [
                { slotId: 's1', provider: 'test', modelId: 'w1', role: 'worker' },
                { slotId: 's2', provider: 'test', modelId: 'r1', role: 'reviewer' },
            ],
        });

        const events = reactState(project(l.getSince(0)));
        const releaseEvents = events.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        expect(releaseEvents.length).toBe(2);
        expect(releaseEvents.some((e) => e.payload.slotId === 's1')).toBe(true);
        expect(releaseEvents.some((e) => e.payload.slotId === 's2')).toBe(true);
    });

    test('does NOT generate duplicate MODEL_POOL_RELEASE for same slot', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 't', review_criteria: [] }],
            originalTask: 't',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
        l.append(Events.SESSION_START, { sessionId: 's1s', nodeId: 'n1', phase: 'worker' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });
        l.append('model_pool:snapshot', { slots: [{ slotId: 's1', provider: 'test', modelId: 'w1', role: 'worker' }] });

        const events1 = reactState(project(l.getSince(0)));
        expect(events1.filter((e) => e.type === Events.MODEL_POOL_RELEASE).length).toBe(1);

        // Append the release command AND simulate side-effect (MODEL_POOL_RELEASE)
        l.append(events1[0].type, events1[0].payload);
        l.append(Events.MODEL_POOL_RELEASE, { slotId: events1[0].payload.slotId });

        const events2 = reactState(project(l.getSince(0)));
        const extraReleases = events2.filter((e) => e.type === Events.MODEL_POOL_RELEASE);
        expect(extraReleases.length).toBe(
            0,
            'Should not generate duplicate MODEL_POOL_RELEASE after release completed',
        );
    });
});

describe('side effects interaction', () => {
    test('SQUAD_INIT with 2 chained nodes - first pass output shape', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: ['n1'] },
            ],
            originalTask: 'test',
        });

        const events = reactState(project(l.getSince(0)));
        expect(events.length).toBe(2, 'Both nodes should get idle status initially');

        for (const e of events) l.append(e.type, e.payload);

        const events2 = reactState(project(l.getSince(0)));
        const n2Event = events2.find((e) => e.payload.nodeId === 'n2');
        expect(n2Event).toBeUndefined('n2 should not get any event yet - n1 is not approved');
        const n1Event = events2.find((e) => e.payload.nodeId === 'n1');
        expect(n1Event.payload.status).toBe(STATUS.AUTHORING);
    });
});

describe('projection model pool usage consistency', () => {
    let project;
    beforeAll(async () => {
        project = (await import('../../shared/projections.js')).project;
    });

    test('MODEL_POOL_ACQUIRE populates usage, MODEL_POOL_RELEASE clears it', () => {
        const l = log();
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
        let state = project(l.getSince(0));
        expect(state.modelPool.usage['s1']).toBeDefined();
        expect(state.modelPool.usage['s1'].inUse).toBe(true);

        l.append(Events.MODEL_POOL_RELEASE, { slotId: 's1' });
        state = project(l.getSince(0));
        expect(state.modelPool.usage['s1']).toBeUndefined();
    });

    test('MODEL_POOL_RELEASE with undefined slotId does NOT clear usage', () => {
        const l = log();
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
        let state = project(l.getSince(0));
        expect(state.modelPool.usage['s1']).toBeDefined();

        l.append(Events.MODEL_POOL_RELEASE, { slotId: undefined });
        state = project(l.getSince(0));
        expect(state.modelPool.usage['s1']).toBeDefined('release with undefined slotId should NOT clear the slot');
    });
});

describe('max retries boundary', () => {
    test('after MAX_RETRIES (5) consecutive reviewer rejections, node goes to FAILED', () => {
        // Build algebraic state: node at REVIEWING with retryCount=4, session 'rs' with 5 rejections
        const state = buildState({
            nodes: [nodeInPhase('n1', 'reviewing', 'rs', { retryCount: MAX_RETRIES - 1 })],
            sessions: {
                rs: {
                    sessionId: 'rs',
                    nodeId: 'n1',
                    phase: 'reviewer',
                    role: 'reviewer',
                    status: 'active',
                    messages: [],
                },
            },
        });

        // Add 4 prior rejections (retryCount already reflects these)
        for (let i = 1; i <= MAX_RETRIES - 1; i++) {
            state.sessions['rs'].messages.push({
                role: 'assistant',
                messageId: `reject-${i}`,
                content: [
                    {
                        type: 'tool_call',
                        toolName: 'return',
                        toolId: `reject-${i}`,
                        params: { status: 'error', reason: `fix ${i}` },
                    },
                ],
            });
        }

        // Add the 5th (fatal) rejection — the one that triggers FAILED
        state.sessions['rs'].messages.push({
            role: 'assistant',
            messageId: 'reject-5',
            content: [
                {
                    type: 'tool_call',
                    toolName: 'return',
                    toolId: 'reject-5',
                    params: { status: 'error', reason: 'fix 5' },
                },
            ],
        });

        const actions = reactState(state);

        // Should emit FAILED (no AUTHORING — retryCount >= MAX_RETRIES)
        const failActions = actions.filter(
            (a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.FAILED,
        );
        expect(failActions.length).toBe(1);
        expect(failActions[0].payload.nodeId).toBe('n1');

        const authActions = actions.filter(
            (a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.AUTHORING,
        );
        expect(authActions.length).toBe(0, 'No AUTHORING after MAX_RETRIES exceeded');
    });

    test('at MAX_RETRIES-1 retries, rejection sends back to AUTHORING', () => {
        // Node at REVIEWING with retryCount=MAX_RETRIES-2, session 'rs' with one more rejection
        const state = buildState({
            nodes: [nodeInPhase('n1', 'reviewing', 'rs', { retryCount: MAX_RETRIES - 2 })],
            sessions: {
                rs: {
                    sessionId: 'rs',
                    nodeId: 'n1',
                    phase: 'reviewer',
                    role: 'reviewer',
                    status: 'active',
                    messages: [
                        {
                            role: 'assistant',
                            messageId: 'reject-1',
                            content: [
                                {
                                    type: 'tool_call',
                                    toolName: 'return',
                                    toolId: 'reject-1',
                                    params: { status: 'error', reason: 'still needs work' },
                                },
                            ],
                        },
                    ],
                },
            },
        });

        const actions = reactState(state);

        // Should emit AUTHORING (retryCount < MAX_RETRIES)
        const authActions = actions.filter(
            (a) => a.type === Events.SQUAD_NODE_STATE && a.payload.status === STATUS.AUTHORING,
        );
        expect(authActions.length).toBe(1);
        expect(authActions[0].payload.retryCount).toBe(MAX_RETRIES - 1);
        expect(authActions[0].payload.feedback).toBe('still needs work');
    });
});

describe('empty model pool fallback', () => {
    test('node with empty model pool skips MODEL_POOL_ACQUIRE, emits CMD_CREATE_SESSION directly', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 'task', review_criteria: [], depends_on: [] }],
            originalTask: 'test',
        });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        // model_pool:snapshot with zero slots
        l.append('model_pool:snapshot', { slots: [] });
        // No MODEL_POOL_ACQUIRE — pool is empty

        const events = reactState(project(l.getSince(0)));

        // Should NOT emit MODEL_POOL_ACQUIRE
        const acquireEvents = events.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE);
        expect(acquireEvents.length).toBe(0, 'no MODEL_POOL_ACQUIRE for empty pool');

        // Should emit CMD_CREATE_SESSION directly (fallback)
        const createEvents = events.filter((e) => e.type === Events.CMD_CREATE_SESSION);
        expect(createEvents.length).toBe(1, 'should create session directly');
        expect(createEvents[0].payload.nodeId).toBe('n1');
        expect(createEvents[0].payload.phase).toBe('worker');
    });

    test('outer review skips model acquisition when no reviewer slots configured', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'M',
            nodes: [{ id: 'n1', task: 'task', review_criteria: [], depends_on: [] }],
            originalTask: 'test',
        });
        // All nodes approved
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.APPROVED });
        l.append('model_pool:snapshot', { slots: [] });

        const events = reactState(project(l.getSince(0)));
        const orStart = events.find((e) => e.type === Events.SQUAD_OUTER_REVIEW_START);
        expect(orStart).toBeDefined();
        expect(orStart.payload.round).toBe(1);

        // After outer review starts, no model acquisition
        l.append(orStart.type, orStart.payload);
        const events2 = reactState(project(l.getSince(0)));
        const acquireEvents = events2.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE);
        expect(acquireEvents.length).toBe(0, 'no model acquisition for empty pool outer review');

        // Should create session directly
        const createEvents = events2.filter((e) => e.type === Events.CMD_CREATE_SESSION);
        expect(createEvents.length).toBe(1, 'should create outer review session directly');
    });
});

describe('concurrent slot allocation (slot stealing)', () => {
    test('3 nodes waiting, 1 model released → only 1 MODEL_POOL_ACQUIRE', () => {
        const l = log();
        l.append(Events.SQUAD_INIT, {
            mode: 'L',
            nodes: [
                { id: 'n1', task: 'first', review_criteria: [], depends_on: [] },
                { id: 'n2', task: 'second', review_criteria: [], depends_on: [] },
                { id: 'n3', task: 'third', review_criteria: [], depends_on: [] },
            ],
            originalTask: 'test',
        });
        // All nodes idle → authoring
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n3', status: 'idle' });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n1', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n2', status: STATUS.AUTHORING });
        l.append(Events.SQUAD_NODE_STATE, { nodeId: 'n3', status: STATUS.AUTHORING });

        // One worker slot in use by n1
        l.append(Events.MODEL_POOL_ACQUIRE, { slotId: 's1', nodeId: 'n1', sessionId: 'n1', role: 'worker' });
        l.append('model_pool:snapshot', { slots: [{ slotId: 's1', provider: 'test', modelId: 'w1', role: 'worker' }] });

        // With 1 slot in use and 0 free, reactor emits 0 MODEL_POOL_ACQUIRE
        const events1 = reactState(project(l.getSince(0)));
        const acquireEvents1 = events1.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE);
        expect(acquireEvents1.length).toBe(0, '0 MODEL_POOL_ACQUIRE when all slots busy');

        // --- Simulate release: n1's slot becomes free ---
        l.append(Events.MODEL_POOL_RELEASE, { slotId: 's1' });
        l.append('model_pool:snapshot', { slots: [{ slotId: 's1', provider: 'test', modelId: 'w1', role: 'worker' }] });

        // 3 waiting nodes, 1 free slot → only 1 MODEL_POOL_ACQUIRE
        const events2 = reactState(project(l.getSince(0)));
        const acquireEvents2 = events2.filter((e) => e.type === Events.MODEL_POOL_ACQUIRE);
        expect(acquireEvents2.length).toBe(1, 'only 1 MODEL_POOL_ACQUIRE for 3 waiting nodes with 1 free slot');
    });
});
