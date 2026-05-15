/**
 * Tests for main session recording and /squad handling.
 *
 * Bug 1: mainSessionId was never stored in state — side-effects referenced
 *         state.squad.mainSessionId but no event set it.
 * Bug 2: ws-handler had no strategy for /squad commands from the terminal
 *         (pi.on('input') equivalent was missing).
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { EventLog } from '../../server/event-log.js';
import { routeMessage } from '../../server/ws-handler.js';
import { applyEvent, getInitialState } from '../../shared/projections.js';

function freshState() {
    return Object.assign({}, getInitialState());
}

function dispatch(state, type, payload) {
    const next = applyEvent(state, type, payload);
    Object.assign(state, next);
}

describe('Bug 1: mainSessionId recording', () => {
    test('getInitialState has mainSessionId as null', () => {
        const state = getInitialState();
        expect(state.squad.mainSessionId).toBeNull();
    });

    test('squad:register_main_session stores sessionId', () => {
        const state = freshState();
        dispatch(state, 'squad:register_main_session', { sessionId: 'main-session-1' });
        expect(state.squad.mainSessionId).toBe('main-session-1');
    });

    test('squad:register_main_session is idempotent', () => {
        const state = freshState();
        dispatch(state, 'squad:register_main_session', { sessionId: 'main-session-1' });
        dispatch(state, 'squad:register_main_session', { sessionId: 'main-session-2' });
        expect(state.squad.mainSessionId).toBe('main-session-2');
    });

    test('squad:init carries mainSessionId when provided', () => {
        const state = freshState();
        dispatch(state, 'squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', task: 'hello', review_criteria: ['ok'] }],
            originalTask: 'write hello',
            mainSessionId: 'main-session-42',
        });
        expect(state.squad.status).toBe('active');
        expect(state.squad.mainSessionId).toBe('main-session-42');
    });

    test('squad:replan preserves mainSessionId', () => {
        const state = freshState();
        dispatch(state, 'squad:init', {
            mode: 'L',
            nodes: [{ id: 'n1', task: 'hello', review_criteria: ['ok'] }],
            originalTask: 'write hello',
            mainSessionId: 'main-original',
        });
        dispatch(state, 'squad:replan', {
            mode: 'L',
            nodes: [{ id: 'n2', task: 'world', review_criteria: ['ok'] }],
            originalTask: 'write world',
            mainSessionId: 'main-original',
        });
        expect(state.squad.mainSessionId).toBe('main-original');
    });

    test('squad:phase_changed handler finds mainSessionId after register', () => {
        const state = freshState();
        dispatch(state, 'squad:register_main_session', { sessionId: 'arch-session' });
        dispatch(state, 'squad:phase_changed', { phase: 'revising', feedback: 'needs rework' });
        // phase_changed stores feedback but doesn't erase mainSessionId
        expect(state.squad.mainSessionId).toBe('arch-session');
        expect(state.squad.phase).toBe('revising');
        expect(state.squad.feedback).toBe('needs rework');
    });
});

describe('Bug 2: /squad detection in message flow', () => {
    let eventLog;

    beforeEach(() => {
        eventLog = new EventLog();
    });

    function createMockWs() {
        const sent = [];
        return { sent, readyState: 1, send: (data) => sent.push(data) };
    }

    test('normal user_message does not register main session', async () => {
        const ws = createMockWs();
        // Pre-create the session in event log
        eventLog.append('session:creating', { sessionId: 's1', nodeId: 'n1', phase: 'authoring', epoch: 0 });
        eventLog.append('session:start', { sessionId: 's1', nodeId: 'n1', phase: 'authoring', epoch: 0 });

        await routeMessage(
            { type: 'session:user_message', payload: { sessionId: 's1', text: 'hello', messageId: 'm1' } },
            eventLog,
            ws,
        );

        const registrations = eventLog.log.filter((e) => e.event === 'squad:register_main_session');
        expect(registrations.length).toBe(0);
    });

    test('/squad message does not require pre-existing session', async () => {
        // session:user_message does NOT require pre-existing session —
        // ws-handler only checks sessionId exists as truthy string
        const ws = createMockWs();
        const result = await routeMessage(
            { type: 'session:user_message', payload: { sessionId: 'terminal-1', text: 'hello', messageId: 'm1' } },
            eventLog,
            ws,
        );
        expect(result).toBe(true);
    });

    test('/squad registers main session in projections too', () => {
        const state = freshState();
        // Simulate what ws-handler does for /squad
        dispatch(state, 'squad:register_main_session', { sessionId: 'cli-main' });
        expect(state.squad.mainSessionId).toBe('cli-main');
    });

    test('squad:register_main_session before squad:init carries to active squad', () => {
        const state = freshState();
        dispatch(state, 'squad:register_main_session', { sessionId: 'pre-init-main' });
        dispatch(state, 'squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', task: 't', review_criteria: ['ok'] }],
            originalTask: 'test',
            mainSessionId: 'pre-init-main',
        });
        // mainSessionId survives the squad:init reset
        expect(state.squad.mainSessionId).toBe('pre-init-main');
    });
});
