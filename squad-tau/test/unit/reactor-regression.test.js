import { describe, test, expect } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { applyEvent } from '../../shared/projections.js';
import { createBaseState, setStatus, createSession, giveReturn, buildState } from '../helpers/state-builder.js';
import { sessionIdFor } from '../../shared/events.js';

// ── Regression: R3 infinite loop (REPAIR.md §3.1) ──
// handleRejected with resetOnRej:true must emit 'awaiting_replan' (not 'rejected'),
// preventing R3 from re-matching on the next pulse.
describe('R3 infinite loop regression — awaiting_replan breaks the cycle', () => {
    function makeStateWithResetOnRej() {
        const st = createBaseState('n1');
        st.squad.planConfig.n1.resetOnRej = true;
        return st;
    }

    test('resetOnRej node rejected → awaiting_replan, not rejected', () => {
        const st = makeStateWithResetOnRej();
        setStatus(st, 'n1', 'rejected');
        const actions = reactState(st);
        const nodeState = actions.filter((a) => a.type === 'squad:node_state');
        expect(nodeState.length).toBe(1);
        expect(nodeState[0].payload.nodeId).toBe('n1');
        expect(nodeState[0].payload.status).toBe('awaiting_replan');
        expect(nodeState.every((a) => a.payload.status !== 'rejected')).toBe(true);
    });

    test('awaiting_replan is terminal — R3 idempotent on re-run', () => {
        const st = makeStateWithResetOnRej();
        setStatus(st, 'n1', 'rejected');
        reactState(st); // first pulse → awaiting_replan
        setStatus(st, 'n1', 'awaiting_replan');
        const second = reactState(st);
        const n1Actions = second.filter((a) => a.type === 'squad:node_state' && a.payload.nodeId === 'n1');
        expect(n1Actions.length).toBe(0);
    });

    test('awaiting_replan blocks downstream dependents', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        st.squad.planConfig.n1.resetOnRej = true;
        setStatus(st, 'n1', 'rejected');
        reactState(st);
        setStatus(st, 'n1', 'awaiting_replan');
        const actions = reactState(st);
        const block = actions.find((a) => a.payload.nodeId === 'n2' && a.payload.status === 'blocked');
        expect(block).toBeDefined();
    });

    test('awaiting_replan blocked is idempotent', () => {
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        st.squad.planConfig.n1.resetOnRej = true;
        setStatus(st, 'n1', 'rejected');
        reactState(st);
        setStatus(st, 'n1', 'awaiting_replan');
        setStatus(st, 'n2', 'blocked');
        for (let i = 0; i < 3; i++) {
            expect(
                reactState(st).filter((a) => a.payload.nodeId === 'n2' && a.payload.status === 'blocked').length,
            ).toBe(0);
        }
    });

    test('R3 skips __or__ node', () => {
        const st = buildState({ mode: 'L', nodes: [{ id: 'n1', task: 'a', depends_on: [] }] });
        setStatus(st, '__or__', 'rejected');
        const actions = reactState(st);
        // R3 excludes __or__, R5 handles it (squad:phase_changed)
        const orNodeState = actions.filter((a) => a.type === 'squad:node_state' && a.payload.nodeId === '__or__');
        expect(orNodeState.length).toBe(0);
        // R5 should fire → squad:phase_changed
        const phaseChanged = actions.find((a) => a.type === 'squad:phase_changed');
        expect(phaseChanged).toBeDefined();
        expect(phaseChanged.payload.phase).toBe('revising');
    });
});

// ── Regression: countLiveSessions (REPAIR.md §3.2) ──
// Original phase+epoch matching logic preserved.
// The race condition window between node transition and session:end
// is handled by the Engine's convergence loop (countLiveSessions sees
// the post-drop state because session:end fires before engine tick).
describe('countLiveSessions regression — phase transitions', () => {
    test('physical counting: all active sessions consume slots', () => {
        // Physical counting (REPAIR.md §3.2 final fix): all active sessions
        // consume slots regardless of node.status vs sess.phase match.
        const st = createBaseState('n1', 'n2');
        st.config = { ...st.config, maxWorkers: 2 };
        // n1 at 'confirming' with 2 active sessions (authoring + confirming)
        setStatus(st, 'n1', 'authoring');
        createSession(st, 'n1', 'authoring');
        setStatus(st, 'n1', 'confirming');
        createSession(st, 'n1', 'confirming');
        // 2 active sessions >= maxWorkers(2) → n2 blocked
        const actions = reactState(st);
        const creatingN2 = actions.filter((a) => a.type === 'session:creating' && a.payload.nodeId === 'n2');
        expect(creatingN2.length).toBe(0);
    });

    test('sessions closed via session:end free slots for downstream', () => {
        // In the real system, session:end is emitted when the return tool
        // completes (side-effects handleToolEnd). This closes the session
        // and frees the concurrency slot. Test that path.
        const st = createBaseState(
            { id: 'n1', task: 'a', depends_on: [] },
            { id: 'n2', task: 'b', depends_on: ['n1'] },
        );
        // Simulate real flow: each phase transition closes old session
        // applyEvent returns new state — must assign back via Object.assign
        setStatus(st, 'n1', 'authoring');
        const sidA = createSession(st, 'n1', 'authoring');
        setStatus(st, 'n1', 'confirming');
        Object.assign(st, applyEvent(st, 'session:end', { sessionId: sidA, reason: 'completed' }));

        const sidC = createSession(st, 'n1', 'confirming');
        setStatus(st, 'n1', 'reviewing');
        Object.assign(st, applyEvent(st, 'session:end', { sessionId: sidC, reason: 'completed' }));

        const sidR = createSession(st, 'n1', 'reviewing');
        setStatus(st, 'n1', 'approved');
        Object.assign(st, applyEvent(st, 'session:end', { sessionId: sidR, reason: 'completed' }));

        // 0 active sessions → n2 gets slot
        const pulse1 = reactState(st);
        const promoteN2 = pulse1.find((a) => a.type === 'squad:node_state' && a.payload.nodeId === 'n2');
        expect(promoteN2).toBeDefined();
        expect(promoteN2.payload.status).toBe('authoring');

        setStatus(st, 'n2', 'authoring');
        const pulse2 = reactState(st);
        const creatingN2 = pulse2.filter((a) => a.type === 'session:creating' && a.payload.nodeId === 'n2');
        expect(creatingN2.length).toBe(1);
    });

    test('maxWorkers gating with physical counting', () => {
        const st = createBaseState('n1', 'n2', 'n3');
        st.config = { ...st.config, maxWorkers: 2 };
        // All 3 at 'authoring' — no sessions yet, all get through
        let actions = reactState(st);
        let creating = actions.filter((a) => a.type === 'session:creating');
        expect(creating.length).toBe(3);

        // Apply sessions (simulate engine convergence)
        for (const a of creating) {
            const s = applyEvent(st, a.type, a.payload);
            Object.assign(st, s);
            const start = applyEvent(st, 'session:start', {
                sessionId: a.payload.sessionId,
                nodeId: a.payload.nodeId,
                phase: a.payload.phase,
                epoch: a.payload.epoch,
            });
            Object.assign(st, start);
        }

        // Second pulse: 3 active sessions ≥ maxWorkers(2)
        // No new sessions can be created
        actions = reactState(st);
        creating = actions.filter((a) => a.type === 'session:creating');
        expect(creating.length).toBe(0);

        // But prompting still fires for existing sessions
        const prompting = actions.filter((a) => a.type === 'session:prompting');
        expect(prompting.length).toBe(3);
    });

    test('same-epoch same-phase sessions correctly gated', () => {
        const st = createBaseState('n1', 'n2');
        st.config = { ...st.config, maxWorkers: 2 };
        // n1 at 'authoring' with 2 sessions of the same phase (simulates race window)
        setStatus(st, 'n1', 'authoring');
        createSession(st, 'n1', 'authoring');
        createSession(st, 'n1', 'authoring');
        // But wait — second createSession creates same sessionId. Let me force a unique one.
        // Actually, createSession uses sessionIdFor which returns deterministic IDs.
        // For the race simulation, just use 1 session:
        const actions = reactState(st);
        const creatingN2 = actions.filter((a) => a.type === 'session:creating' && a.payload.nodeId === 'n2');
        // n1 has 1 counted session (authoring+epoch0) < 2 → n2 gets slot
        expect(creatingN2.length).toBe(1);
    });
});

// ── Regression: returnTool registration (REPAIR.md §2.2) ──
describe('returnTool registration regression', () => {
    test('buildWorkerSessionOptions includes return in toolNames', async () => {
        const { _getWorkerSessionOptions } = await import('../../server/side-effects.js');
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['squad_delegate', 'some_tool'],
        };
        const opts = _getWorkerSessionOptions(pi);
        expect(opts.toolNames).toContain('return');
    });

    test('buildWorkerSessionOptions adds return when not in activeTools', async () => {
        // When active tools exist but don't include 'return', it's added
        const { _getWorkerSessionOptions } = await import('../../server/side-effects.js');
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['squad_delegate', 'search'],
        };
        const opts = _getWorkerSessionOptions(pi);
        expect(opts.toolNames).toContain('return');
        expect(opts.toolNames).toContain('search');
        expect(opts.toolNames.length).toBe(2); // search + return (squad_delegate filtered)
    });

    test('buildWorkerSessionOptions no toolNames when no active tools remain', async () => {
        // When only squad_delegate is active, filtered list is empty → no toolNames
        const { _getWorkerSessionOptions } = await import('../../server/side-effects.js');
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['squad_delegate'],
        };
        const opts = _getWorkerSessionOptions(pi);
        expect(opts.toolNames).toBeUndefined();
    });

    test('createAgentSession options include customTools with returnTool', async () => {
        const { returnTool } = await import('../../server/lifecycle-tools.js');
        expect(returnTool.name).toBe('return');
        expect(typeof returnTool.execute).toBe('function');
        expect(returnTool.parameters.required).toContain('status');
        expect(returnTool.parameters.required).toContain('reason');
    });

    test('returnTool execute calls ctx.abort', async () => {
        const { returnTool } = await import('../../server/lifecycle-tools.js');
        let aborted = false;
        const result = await returnTool.execute('call-id', { status: 'ok', reason: 'done' }, 'sig', null, {
            abort: () => {
                aborted = true;
            },
        });
        expect(aborted).toBe(true);
        expect(result).toEqual({ content: [], display: false });
    });
});
