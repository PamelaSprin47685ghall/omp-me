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

// ── Regression: countLiveSessions (physical-reality semantics) ──
// countLiveSessions counts sessions by their own status ('active'/'creating'),
// NOT by matching node phase/epoch. A session is physically "live" as long as
// its LLM connection hasn't terminated (session:end).
// When a node phase changes, the existing session is still live and still counts.
// The reactor prompts the existing session for the new phase instead of creating
// a new one. Only session:end frees the concurrency slot.
describe('countLiveSessions regression — physical-reality semantics', () => {
    test('active session counts regardless of node phase', () => {
        const st = createBaseState('n1');
        st.config = { ...st.config, maxWorkers: 1 };
        setStatus(st, 'n1', 'authoring');
        createSession(st, 'n1', 'authoring');
        // 1 active session = maxWorkers → no new sessions
        const actions = reactState(st);
        expect(actions.filter((a) => a.type === 'session:creating').length).toBe(0);
        // Prompting fires for existing session
        expect(actions.filter((a) => a.type === 'session:prompting').length).toBe(1);
    });

    test('phase progression does NOT free slot — old session still active', () => {
        const st = createBaseState('n1');
        st.config = { ...st.config, maxWorkers: 1 };
        setStatus(st, 'n1', 'authoring');
        createSession(st, 'n1', 'authoring');
        // n1 moves to 'confirming' — old session still physically alive
        setStatus(st, 'n1', 'confirming');
        const actions = reactState(st);
        // countLiveSessions = 1 (session still active) >= maxWorkers → no new session
        const creating = actions.filter((a) => a.type === 'session:creating' && a.payload.nodeId === 'n1');
        expect(creating.length).toBe(0);
        // Instead of creating a new session, reactor prompts the existing one for the new phase
        const prompting = actions.filter((a) => a.type === 'session:prompting' && a.payload.nodeId === 'n1');
        expect(prompting.length).toBe(1);
        expect(prompting[0].payload.phase).toBe('confirming');
    });

    test('session:end frees the concurrency slot for a new epoch', () => {
        const st = createBaseState('n1');
        st.config = { ...st.config, maxWorkers: 1 };
        setStatus(st, 'n1', 'authoring', { epoch: 0 });
        createSession(st, 'n1', 'authoring');
        giveReturn(st, sessionIdFor('n1', 'authoring', 0), 'ok', 'done');
        // After session:end, session is 'completed' → 0 live
        // Node advanced to 'confirming' via node:work_submitted
        const actionsBefore = reactState(st);
        const creatingBefore = actionsBefore.filter((a) => a.type === 'session:creating');
        // Session ended, node at 'confirming' → new session created for confirming
        const confirmingCreating = creatingBefore.filter(
            (a) => a.payload.nodeId === 'n1' && a.payload.phase === 'confirming',
        );
        expect(confirmingCreating.length).toBe(1);
    });

    test('active old-epoch session blocks new epoch creation — stall until session:end', () => {
        const st = createBaseState('n1');
        st.config = { ...st.config, maxWorkers: 1 };
        setStatus(st, 'n1', 'authoring', { epoch: 0 });
        createSession(st, 'n1', 'authoring');
        // Force rejected + new epoch WITHOUT ending the old session
        setStatus(st, 'n1', 'rejected', { epoch: 0 });
        setStatus(st, 'n1', 'authoring', { epoch: 1 });
        // Old session (epoch 0) is still physically active (LLM connection alive)
        // New epoch needs sessionId n1::v1, but old n1::v0 still active
        // countLiveSessions = 1 >= maxWorkers = 1 → stall: no actions
        const actions = reactState(st);
        expect(actions.filter((a) => a.type === 'session:creating').length).toBe(0);
        expect(actions.filter((a) => a.type === 'session:prompting').length).toBe(0);
    });

    test('cross-node concurrency respects maxWorkers', () => {
        const st = createBaseState('n1', 'n2', 'n3');
        st.config = { ...st.config, maxWorkers: 2 };
        // All 3 at 'authoring' — no sessions yet, R4 creates sessions for all
        let actions = reactState(st);
        let creating = actions.filter((a) => a.type === 'session:creating');
        expect(creating.length).toBe(3);

        // Apply sessions to state
        for (const a of creating) {
            const s = applyEvent(st, a.type, a.payload);
            Object.assign(st, s);
            Object.assign(
                st,
                applyEvent(st, 'session:start', {
                    sessionId: a.payload.sessionId,
                    nodeId: a.payload.nodeId,
                    phase: a.payload.phase,
                    epoch: a.payload.epoch,
                }),
            );
        }

        // Now 3 active sessions ≥ maxWorkers=2 → no new sessions
        actions = reactState(st);
        creating = actions.filter((a) => a.type === 'session:creating');
        expect(creating.length).toBe(0);

        // Prompting still fires for existing sessions
        const prompting = actions.filter((a) => a.type === 'session:prompting');
        expect(prompting.length).toBe(3);
    });

    test('end one session frees slot for another node', () => {
        const st = createBaseState('n1', 'n2');
        st.config = { ...st.config, maxWorkers: 2 };
        // n1 at 'authoring' with session
        setStatus(st, 'n1', 'authoring');
        createSession(st, 'n1', 'authoring');
        // n2 at 'authoring' with session
        setStatus(st, 'n2', 'authoring');
        createSession(st, 'n2', 'authoring');
        // 2 active = maxWorkers
        // n1 moves to 'confirming' → session still active → 2 active
        setStatus(st, 'n1', 'confirming');
        // End n1's session → 1 active → slot free for...
        // n1's session ended, count=1 < maxWorkers=2 → new session for n1 (confirming)
        // or if n2's session needed something
        const sid = sessionIdFor('n1', 'authoring', 0);
        let s = applyEvent(st, 'session:end', { sessionId: sid, reason: 'completed' });
        Object.assign(st, s);

        const actions = reactState(st);
        const n1Creating = actions.filter((a) => a.type === 'session:creating' && a.payload.nodeId === 'n1');
        expect(n1Creating.length).toBe(1);
        expect(n1Creating[0].payload.phase).toBe('confirming');
    });
});

// ── Regression: returnTool registration (REPAIR.md §2.2) ──
describe('returnTool registration regression', () => {
    test('buildWorkerSessionOptions excludes return from toolNames (passed via customTools)', async () => {
        const { _getWorkerSessionOptions } = await import('../../server/side-effects.js');
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['squad_delegate', 'some_tool'],
        };
        const opts = _getWorkerSessionOptions(pi);
        // return is now passed as customTools, not toolNames
        expect(opts.toolNames).not.toContain('return');
        expect(opts.toolNames).toContain('some_tool');
    });

    test('buildWorkerSessionOptions preserves active tools minus squad_delegate and return', async () => {
        const { _getWorkerSessionOptions } = await import('../../server/side-effects.js');
        const pi = {
            getThinkingLevel: () => undefined,
            getActiveTools: () => ['squad_delegate', 'search'],
        };
        const opts = _getWorkerSessionOptions(pi);
        // return filtered out from toolNames (passed as customTools)
        expect(opts.toolNames).not.toContain('return');
        expect(opts.toolNames).toContain('search');
        expect(opts.toolNames.length).toBe(1); // only search (squad_delegate + return filtered)
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
