/**
 * Engine — Time-Traveler (pure convergence loop via converge()).
 *
 * Every test: seed events → converge() → assert final State + Log invariants.
 * No PulseEngine, no manual while loops, no procedural side-effect simulation.
 * All side effects are pure event emission through the declarative map.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { project, applyEvent, getInitialState } from '../../shared/projections.js';
import { converge, autoCompleteSessions, alwaysRejectSessions } from '../helpers/converge.js';

// ── Tick replay: fold log tick-by-tick tracking activeCount ──

function replayTickActiveCount(log) {
    const counts = [];
    let state = getInitialState();
    let currentTick = -1;
    for (const entry of log) {
        state = applyEvent(state, entry.event, entry.payload);
        if (entry.tick !== currentTick) {
            currentTick = entry.tick;
            counts.push(state.stats.activeCount);
        }
    }
    return counts;
}

describe('Engine — Converge (pure spacetime folder)', () => {
    // ── M-mode chain ──

    it('3-node M-mode DAG converges from init to complete in <10ms', () => {
        const nodes = [
            { id: 'n1', depends_on: [] },
            { id: 'n2', depends_on: ['n1'] },
            { id: 'n3', depends_on: ['n2'] },
        ];

        const start = performance.now();
        const { state, log, converged } = converge([{ event: 'squad:init', payload: { nodes, mode: 'M' } }], {
            'session:pending_creation': autoCompleteSessions,
        });
        const elapsed = performance.now() - start;

        assert.ok(converged, 'convergence must terminate normally');
        assert.equal(state.squad.status, 'complete', 'squad should reach complete');
        assert.equal(state.nodes.n1.status, 'approved');
        assert.equal(state.nodes.n2.status, 'approved');
        assert.equal(state.nodes.n3.status, 'approved');

        // Causal ordering: session:start.id > session:pending_creation.id
        for (const entry of log) {
            if (entry.event === 'session:start') {
                const pend = log.find(
                    (e) => e.event === 'session:pending_creation' && e.payload.sessionId === entry.payload.sessionId,
                );
                if (pend) assert.ok(entry.id > pend.id, `start(${entry.id}) > pending(${pend.id})`);
            }
        }

        // activeCount ≤ maxWorkers at every tick
        for (const c of replayTickActiveCount(log)) {
            assert.ok(c <= 3, `activeCount ${c} exceeds maxWorkers 3`);
        }

        assert.ok(elapsed < 10, `converge took ${elapsed.toFixed(2)}ms (must be <10ms)`);
        console.log(`✓ 3-node M-mode: ${log.length} log entries in ${elapsed.toFixed(2)}ms`);
    });

    // ── L-mode outer review ──

    it('5-node L-mode DAG with outer review converges correctly', () => {
        const nodes = [
            { id: 'n1', depends_on: [] },
            { id: 'n2', depends_on: [] },
            { id: 'n3', depends_on: ['n1', 'n2'] },
            { id: '__or__', depends_on: ['n1', 'n2', 'n3'] },
        ];

        const { state, log } = converge([{ event: 'squad:init', payload: { nodes, mode: 'L' } }], {
            'session:pending_creation': autoCompleteSessions,
        });

        assert.equal(state.squad.status, 'complete', 'L-mode DAG should reach complete');
        for (const id of ['n1', 'n2', 'n3', '__or__']) {
            assert.ok(
                ['approved', 'failed'].includes(state.nodes[id].status),
                `node ${id} should be terminal, got ${state.nodes[id].status}`,
            );
        }

        // Causal ordering
        const pendings = log.filter((e) => e.event === 'session:pending_creation');
        const starts = log.filter((e) => e.event === 'session:start');
        for (const s of starts) {
            const pend = pendings.find((p) => p.payload.sessionId === s.payload.sessionId);
            if (pend) assert.ok(s.id > pend.id, `start(${s.id}) > pending(${pend.id})`);
        }

        for (const c of replayTickActiveCount(log)) {
            assert.ok(c <= 3, `L-mode activeCount ${c} exceeds 3`);
        }

        console.log(`✓ 5-node L-mode: ${log.length} log entries`);
    });

    // ── Concurrency gate ──

    it('activeCount never exceeds maxWorkers during any single tick', () => {
        const nodes = [];
        for (let i = 1; i <= 6; i++) nodes.push({ id: `n${i}`, depends_on: [] });

        const { log } = converge([{ event: 'squad:init', payload: { nodes, mode: 'M' } }], {
            'session:pending_creation': autoCompleteSessions,
        });

        const counts = replayTickActiveCount(log);
        for (const c of counts) {
            assert.ok(c <= 3, `activeCount ${c} exceeds maxWorkers 3`);
        }
        console.log(`✓ Capacity test: max activeCount seen = ${Math.max(...counts)}`);
    });

    // ── Diamond ──

    it('diamond A→B,C→D with ordering assertions', () => {
        const nodes = [
            { id: 'A', depends_on: [] },
            { id: 'B', depends_on: ['A'] },
            { id: 'C', depends_on: ['A'] },
            { id: 'D', depends_on: ['B', 'C'] },
        ];

        const { state, log } = converge([{ event: 'squad:init', payload: { nodes, mode: 'L' } }], {
            'session:pending_creation': autoCompleteSessions,
        });

        assert.equal(state.squad.status, 'complete', 'diamond should converge');

        // Ordering: A session → B authoring, C authoring, then D authoring after B,C
        const aSess = log.findIndex((e) => e.event === 'session:pending_creation' && e.payload.nodeId === 'A');
        const bAuth = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'B' && e.payload.status === 'authoring',
        );
        const cAuth = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'C' && e.payload.status === 'authoring',
        );
        const dAuth = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'D' && e.payload.status === 'authoring',
        );

        assert.ok(aSess >= 0, 'A session pending');
        assert.ok(bAuth > aSess, `B(${bAuth}) > A(${aSess})`);
        assert.ok(cAuth > aSess, `C(${cAuth}) > A(${aSess})`);
        assert.ok(dAuth > Math.max(bAuth, cAuth), `D(${dAuth}) > max(B=${bAuth},C=${cAuth})`);

        for (const c of replayTickActiveCount(log)) assert.ok(c <= 3, `activeCount ${c} exceeds 3`);
        console.log(`✓ Diamond: ${log.length} log entries`);
    });

    // ── Retry: reject once then succeed ──

    it('reviewer rejects once then succeeds', () => {
        let reviewRejected = false;

        const { state } = converge(
            [{ event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } }],
            {
                'session:pending_creation': (payload, emit) => {
                    emit('session:start', {
                        sessionId: payload.sessionId,
                        nodeId: payload.nodeId,
                        epoch: payload.epoch,
                        phase: payload.phase,
                        model: 'simulated',
                    });
                    // Reject on first reviewing phase, accept otherwise
                    if (payload.phase === 'reviewing' && !reviewRejected) {
                        reviewRejected = true;
                        emit('session:end', { sessionId: payload.sessionId, reason: 'error', errorMessage: 'fix it' });
                    } else {
                        emit('session:end', { sessionId: payload.sessionId, reason: 'completed' });
                    }
                },
            },
        );

        assert.equal(state.squad.status, 'complete', 'squad completed after retry');
        assert.equal(state.nodes.n1.status, 'approved', 'n1 approved after retry');
        assert.ok(reviewRejected, 'review rejection was triggered');
        console.log(`✓ Retry: rejected once then succeeded`);
    });

    // ── Retry: exhaust ──

    it('always reject eventually exhausts retries and fails', () => {
        const { state } = converge(
            [{ event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } }],
            { 'session:pending_creation': alwaysRejectSessions },
        );

        assert.equal(state.squad.status, 'complete', 'squad completes even when node fails');
        assert.equal(state.nodes.n1.status, 'failed', 'n1 failed after exhausting retries');
        assert.ok(state.nodes.n1.epoch >= 5, `n1 epoch ${state.nodes.n1.epoch} should be >= 5`);
        console.log(`✓ Retry: always reject → n1 failed after epoch ${state.nodes.n1.epoch}`);
    });

    // ── Outer review rejection (L mode) ──

    it('outer review rejection triggers revising phase (squad active, not complete)', () => {
        const nodes = [
            { id: 'n1', depends_on: [] },
            { id: '__or__', depends_on: ['n1'] },
        ];

        const maxIterations = 100;
        const { state, log } = converge(
            [{ event: 'squad:init', payload: { nodes, mode: 'L' } }],
            {
                'session:pending_creation': (payload, emit) => {
                    emit('session:start', {
                        sessionId: payload.sessionId,
                        nodeId: payload.nodeId,
                        epoch: payload.epoch,
                        phase: payload.phase,
                        model: 'simulated',
                    });
                    // __or__ reviewing → reject (outer review failure)
                    if (payload.nodeId === '__or__' && payload.phase === 'reviewing') {
                        emit('session:end', {
                            sessionId: payload.sessionId,
                            reason: 'error',
                            errorMessage: 'needs fundamental redesign',
                        });
                    } else {
                        emit('session:end', { sessionId: payload.sessionId, reason: 'completed' });
                    }
                },
            },
            maxIterations,
        );

        // R5 keeps resetting workers when __or__ is rejected → squad stays active.
        // converge() never reaches quiescence because R5 always fires again.
        assert.equal(state.squad.status, 'active', 'squad stays active after outer review rejection');
        assert.equal(state.nodes['__or__'].status, 'reviewing', '__or__ reset to reviewing by R5');
        assert.ok(state.nodes['__or__'].epoch >= 1, '__or__ epoch advanced (rejected then reset)');

        const rejectedEvents = log.filter((e) => e.event === 'node:rejected' && e.payload.nodeId === '__or__');
        assert.ok(rejectedEvents.length >= 1, 'at least one node:rejected for __or__ in log');
        console.log(
            `✓ Outer review: __or__ rejected ${rejectedEvents.length}×, final epoch=${state.nodes['__or__'].epoch}`,
        );
    });

    // ── Lexicon ban ──

    it('no MODEL_POOL_ACQUIRE/RELEASE events in log (lexicon ban)', () => {
        const { log } = converge(
            [{ event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } }],
            { 'session:pending_creation': autoCompleteSessions },
        );

        assert.equal(
            log.filter((e) => e.event === 'model_pool:acquire').length,
            0,
            'model_pool:acquire must not appear',
        );
        assert.equal(
            log.filter((e) => e.event === 'model_pool:release').length,
            0,
            'model_pool:release must not appear',
        );
    });

    // ── squad:complete is last ──

    it('SQUAD_COMPLETE is the last event in the log', () => {
        const { log } = converge(
            [{ event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } }],
            { 'session:pending_creation': autoCompleteSessions },
        );

        const lastEntry = log[log.length - 1];
        assert.equal(lastEntry.event, 'squad:complete', 'last entry must be squad:complete, got ' + lastEntry.event);
    });

    // ── Chaotic retry: 3 rejects → accept ──

    it('reviewer rejects 3 times then accepts 4th — convergence after chaos', () => {
        let n1ReviewRejects = 0;

        const { state, log } = converge(
            [{ event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } }],
            {
                'session:pending_creation': (payload, emit) => {
                    emit('session:start', {
                        sessionId: payload.sessionId,
                        nodeId: payload.nodeId,
                        epoch: payload.epoch,
                        phase: payload.phase,
                        model: 'simulated',
                    });
                    if (payload.phase === 'reviewing' && n1ReviewRejects < 3) {
                        n1ReviewRejects++;
                        emit('session:end', {
                            sessionId: payload.sessionId,
                            reason: 'error',
                            errorMessage: 'chaotic rejection #' + n1ReviewRejects,
                        });
                    } else {
                        emit('session:end', { sessionId: payload.sessionId, reason: 'completed' });
                    }
                },
            },
        );

        assert.equal(state.squad.status, 'complete', 'squad converged after 3 rejects');
        assert.equal(state.nodes.n1.status, 'approved', 'n1 approved after retries');
        const rejectedEvents = log.filter((e) => e.event === 'node:rejected' && e.payload.nodeId === 'n1');
        assert.equal(rejectedEvents.length, 3, 'exactly 3 node:rejected entries in log');
        console.log(`✓ Chaos retry: 3 rejects → approved, ${log.length} log entries`);
    });
});
