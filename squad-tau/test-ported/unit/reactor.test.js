import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { reactState } from '../../server/reactor.js';
import { getInitialState, project } from '../../shared/projections.js';

// Helper: build minimal active squad state with given nodes
function stateWith(nodes, overrides = {}) {
    const s = getInitialState();
    s.nodes = Object.create(null);
    for (const n of nodes) s.nodes[n.id] = { ...n };
    s.squad = { status: 'active', mode: overrides.mode || 'M', originalTask: '' };
    if (overrides.maxWorkers !== undefined) s.config.maxWorkers = overrides.maxWorkers;
    if (overrides.activeCount !== undefined) s.stats.activeCount = overrides.activeCount;
    return s;
}

describe('Reactor — Algebraic Assertions', () => {
    // ── Concurrency Gate ──

    it('emits nothing when activeCount equals maxWorkers (capacity full)', () => {
        const s = stateWith([{ id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined }], {
            maxWorkers: 3,
            activeCount: 3,
        });
        const facts = reactState(s);
        const pending = facts.filter((f) => f.event === 'session:pending_creation');
        assert.equal(pending.length, 0, 'should not create sessions at capacity');
    });

    it('emits pending_creation when capacity available', () => {
        const s = stateWith([{ id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined }], {
            maxWorkers: 3,
            activeCount: 1,
        });
        const facts = reactState(s);
        assert.ok(
            facts.some((f) => f.event === 'session:pending_creation'),
            'should create session with available capacity',
        );
    });

    // ── Dependency Unlock ──

    it('unlocks node when all upstream deps are approved', () => {
        const s = stateWith([
            { id: 'n1', status: 'approved', depends_on: [], epoch: 0, summary: 'done' },
            { id: 'n2', status: undefined, depends_on: ['n1'], epoch: 0, summary: undefined },
        ]);
        const facts = reactState(s);
        const nodeState = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n2');
        assert.equal(nodeState.length, 1, 'should unlock n2');
        assert.equal(nodeState[0].payload.status, 'authoring');
    });

    it('does NOT unlock node when upstream deps are not yet approved', () => {
        const s = stateWith([
            { id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined },
            { id: 'n2', status: undefined, depends_on: ['n1'], epoch: 0, summary: undefined },
        ]);
        const facts = reactState(s);
        const unlocks = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n2');
        assert.equal(unlocks.length, 0, 'n2 should remain locked');
    });

    it('no-deps node unlocks immediately', () => {
        const s = stateWith([{ id: 'n1', status: undefined, depends_on: [], epoch: 0, summary: undefined }]);
        const facts = reactState(s);
        assert.ok(
            facts.some(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
            ),
        );
    });

    // ── Retry Boundary ──

    it('rejected node with epoch > MAX_RETRIES becomes failed', () => {
        const s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 6, summary: undefined }]);
        const facts = reactState(s);
        assert.ok(
            facts.some((f) => f.event === 'node:failed' && f.payload.nodeId === 'n1'),
            'should emit node:failed when retries exhausted',
        );
    });

    it('rejected node within retry limit gets epoch bump and authoring', () => {
        const s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 2, summary: undefined }]);
        const facts = reactState(s);
        const retry = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1');
        assert.equal(retry.length, 1);
        assert.equal(retry[0].payload.status, 'authoring');
        assert.equal(retry[0].payload.epoch, 3); // epoch+1
    });

    // ── Circular Dependency Immunity ──

    it('circular dependency produces no actions (silent)', () => {
        const s = stateWith([
            { id: 'n1', status: undefined, depends_on: ['n2'], epoch: 0, summary: undefined },
            { id: 'n2', status: undefined, depends_on: ['n1'], epoch: 0, summary: undefined },
        ]);
        const facts = reactState(s);
        assert.equal(facts.length, 0, 'circular dep should cause no emissions');
    });

    // ── Session Phase Advancement ──

    it('completed session advances node to next phase', () => {
        const s = stateWith([{ id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined }]);
        s.runtime.sessions['urn:squad:node:n1:v0'] = {
            sessionId: 'urn:squad:node:n1:v0',
            nodeId: 'n1',
            phase: 'authoring',
            epoch: 0,
            status: 'ended',
            reason: 'completed',
        };
        const facts = reactState(s);
        assert.ok(
            facts.some(
                (f) =>
                    f.event === 'node:phase_advanced' && f.payload.nodeId === 'n1' && f.payload.status === 'confirming',
            ),
            'should advance from authoring to confirming',
        );
    });

    it('completed final phase session marks node approved', () => {
        const s = stateWith([{ id: 'n1', status: 'reviewing', depends_on: [], epoch: 0, summary: undefined }]);
        s.runtime.sessions['urn:squad:node:n1:v0'] = {
            sessionId: 'urn:squad:node:n1:v0',
            nodeId: 'n1',
            phase: 'reviewing',
            epoch: 0,
            status: 'ended',
            reason: 'completed',
        };
        const facts = reactState(s);
        assert.ok(
            facts.some(
                (f) =>
                    f.event === 'node:phase_advanced' && f.payload.nodeId === 'n1' && f.payload.status === 'approved',
            ),
            'should mark approved on final phase completion',
        );
    });

    it('errored session triggers rejection', () => {
        const s = stateWith([{ id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined }]);
        s.runtime.sessions['urn:squad:node:n1:v0'] = {
            sessionId: 'urn:squad:node:n1:v0',
            nodeId: 'n1',
            phase: 'authoring',
            epoch: 0,
            status: 'ended',
            reason: 'error',
            errorMessage: 'LLM crashed',
        };
        const facts = reactState(s);
        assert.ok(
            facts.some((f) => f.event === 'node:rejected' && f.payload.nodeId === 'n1'),
            'errored session should reject the node',
        );
    });

    // ── M-mode Complete ──

    it('all nodes terminal in M mode triggers squad:complete', () => {
        const s = stateWith([
            { id: 'n1', status: 'approved', depends_on: [], epoch: 0, summary: 'ok' },
            { id: 'n2', status: 'approved', depends_on: ['n1'], epoch: 0, summary: 'ok' },
        ]);
        const facts = reactState(s);
        assert.ok(
            facts.some((f) => f.event === 'squad:complete'),
            'should complete squad when all nodes are terminal',
        );
        const complete = facts.find((f) => f.event === 'squad:complete');
        assert.equal(complete.payload.results.length, 2);
    });

    it('incomplete M mode does not complete', () => {
        const s = stateWith([
            { id: 'n1', status: 'approved', depends_on: [], epoch: 0, summary: 'ok' },
            { id: 'n2', status: 'authoring', depends_on: [], epoch: 0, summary: undefined },
        ]);
        const facts = reactState(s);
        assert.ok(!facts.some((f) => f.event === 'squad:complete'), 'should not complete while nodes are active');
    });

    // ── L mode outer review ──

    it('__or__ rejection resets workers (L mode)', () => {
        const s = stateWith(
            [
                { id: 'n1', status: 'approved', depends_on: ['n2'], epoch: 0, summary: 'ok' },
                { id: 'n2', status: 'approved', depends_on: [], epoch: 0, summary: 'ok' },
                { id: '__or__', status: 'rejected', depends_on: ['n1', 'n2'], epoch: 0, summary: undefined },
            ],
            { mode: 'L' },
        );
        const facts = reactState(s);
        // Workers should be reset to authoring
        assert.ok(
            facts.some(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
            ),
            'n1 should reset to authoring',
        );
        assert.ok(
            facts.some(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n2' && f.payload.status === 'authoring',
            ),
            'n2 should reset to authoring',
        );
        // __or__ should retry with epoch+1
        const orUpdate = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === '__or__');
        assert.equal(orUpdate.length, 1);
        assert.equal(orUpdate[0].payload.status, 'reviewing');
        assert.equal(orUpdate[0].payload.epoch, 1);
    });

    it('__or__ approved completes the squad (L mode)', () => {
        const s = stateWith(
            [
                { id: 'n1', status: 'approved', depends_on: [], epoch: 0, summary: 'ok' },
                { id: '__or__', status: 'approved', depends_on: ['n1'], epoch: 0, summary: undefined },
            ],
            { mode: 'L' },
        );
        const facts = reactState(s);
        assert.ok(
            facts.some((f) => f.event === 'squad:complete'),
            'L mode should complete when __or__ approves',
        );
    });

    // ── Ported: reactor-orthogonal — retry boundary explicit ──

    it('after MAX_RETRIES rejections in sequence, node becomes failed (explicit epochs)', () => {
        // Step 1: epoch=0, status=rejected → R4 emits authoring with epoch=1
        let s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 0, summary: undefined }]);
        let facts = reactState(s);
        let auth = facts.filter(
            (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
        );
        assert.equal(auth.length, 1, 'epoch 0 rejection → authoring epoch=1');
        assert.equal(auth[0].payload.epoch, 1);
        assert.equal(facts.filter((f) => f.event === 'node:failed').length, 0, 'not failed yet');

        // Step 2: epoch=1, rejected → authoring epoch=2
        s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 1, summary: undefined }]);
        facts = reactState(s);
        auth = facts.filter(
            (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
        );
        assert.equal(auth[0].payload.epoch, 2);

        // Step 3: epoch=2 → authoring epoch=3
        s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 2, summary: undefined }]);
        facts = reactState(s);
        assert.equal(
            facts.filter(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
            )[0].payload.epoch,
            3,
        );

        // Step 4: epoch=3 → authoring epoch=4
        s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 3, summary: undefined }]);
        facts = reactState(s);
        assert.equal(
            facts.filter(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
            )[0].payload.epoch,
            4,
        );

        // Step 5: epoch=4 (MAX_RETRIES-1) → authoring epoch=5
        s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 4, summary: undefined }]);
        facts = reactState(s);
        assert.equal(
            facts.filter(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
            )[0].payload.epoch,
            5,
        );

        // Step 6: epoch=5 (==MAX_RETRIES), rejected → node:failed, no more authoring
        s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 5, summary: undefined }]);
        facts = reactState(s);
        assert.equal(
            facts.filter((f) => f.event === 'node:failed' && f.payload.nodeId === 'n1').length,
            1,
            'epoch=5 (>MAX_RETRIES) should emit node:failed',
        );
        assert.equal(
            facts.filter((f) => f.event === 'squad:node_state' && f.payload.status === 'authoring').length,
            0,
            'no more authoring after max retries',
        );
    });

    it('at MAX_RETRIES-1 (epoch=4), rejection sends back to authoring with epoch=5', () => {
        const s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 4, summary: undefined }]);
        const facts = reactState(s);
        const auth = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1');
        assert.equal(auth.length, 1);
        assert.equal(auth[0].payload.status, 'authoring');
        assert.equal(auth[0].payload.epoch, 5);
        assert.equal(facts.filter((f) => f.event === 'node:failed').length, 0, 'should NOT fail at MAX_RETRIES-1');
    });

    // ── Ported: reactor-orthogonal — pending session blocks re-creation ──

    it('pending session blocks duplicate session:pending_creation for same node', () => {
        // Node n1 has session:pending_creation but NOT session:start yet.
        // R2 must NOT emit another pending_creation for the same node.
        const log = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            {
                event: 'session:pending_creation',
                payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
            },
        ];
        const state = project(log);
        const facts = reactState(state);
        const pending = facts.filter((f) => f.event === 'session:pending_creation');
        assert.equal(pending.length, 0, 'pending session must block duplicate creation for same node');
    });

    it('prompting session also blocks duplicate session:pending_creation', () => {
        // session:pending_creation → session:start (active) → session:pending_prompt → status=prompting
        // R2 must also treat 'prompting' status as an active session blocker.
        const log = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            {
                event: 'session:pending_creation',
                payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
            },
            { event: 'session:start', payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', epoch: 0 } },
            {
                event: 'session:pending_prompt',
                payload: { sessionId: 'urn:squad:session:n1:v0:p0', text: 'continue?' },
            },
        ];
        const state = project(log);
        assert.equal(state.runtime.sessions['urn:squad:session:n1:v0:p0'].status, 'prompting');
        const facts = reactState(state);
        const pending = facts.filter((f) => f.event === 'session:pending_creation');
        assert.equal(pending.length, 0, 'prompting session must block duplicate creation');
    });

    // ── Ported: reactor-orthogonal — concurrency within limit ──

    it('emits pending_creation for all authoring nodes within capacity', () => {
        const s = stateWith(
            [
                { id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined },
                { id: 'n2', status: 'authoring', depends_on: [], epoch: 0, summary: undefined },
            ],
            { maxWorkers: 3, activeCount: 0 },
        );
        const facts = reactState(s);
        const pending = facts.filter((f) => f.event === 'session:pending_creation');
        assert.equal(pending.length, 2, 'should create one session per authoring node');
    });

    // ── Ported: reactor-dag-invariants — chain dependency ──

    it('chain: n2 unlocked when n1 fails (failed deps allowed in new arch)', () => {
        // New architecture treats 'failed' as terminal — downstream can still proceed
        const s = stateWith([
            { id: 'n1', status: 'failed', depends_on: [], epoch: 0, summary: undefined },
            { id: 'n2', status: undefined, depends_on: ['n1'], epoch: 0, summary: undefined },
        ]);
        const facts = reactState(s);
        const unlock = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n2');
        assert.equal(unlock.length, 1, 'n2 should unlock when n1 terminates (approved/failed)');
        assert.equal(unlock[0].payload.status, 'authoring', 'n2 starts authoring after dep completes');
    });

    it('chain: idempotent — reactor does NOT re-emit unlock for already-unlocked node', () => {
        const s = stateWith([
            { id: 'n1', status: 'failed', depends_on: [], epoch: 0, summary: undefined },
            { id: 'n2', status: 'authoring', depends_on: ['n1'], epoch: 0, summary: undefined },
        ]);
        // n2 already authoring, deps met → R1 skip (status is truthy)
        // R2 should handle (session already covered check)
        const facts = reactState(s);
        const nodeStateFacts = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n2');
        assert.equal(nodeStateFacts.length, 0, 'no re-emission of node_state for already-active node');
    });

    // ── Ported: reactor-dag-invariants — diamond ──

    it('diamond: A approved → B,C start authoring, D stays locked', () => {
        const s = stateWith([
            { id: 'A', status: 'approved', depends_on: [], epoch: 0, summary: 'done' },
            { id: 'B', status: undefined, depends_on: ['A'], epoch: 0, summary: undefined },
            { id: 'C', status: undefined, depends_on: ['A'], epoch: 0, summary: undefined },
            { id: 'D', status: undefined, depends_on: ['B', 'C'], epoch: 0, summary: undefined },
        ]);
        const facts = reactState(s);
        assert.ok(
            facts.some(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'B' && f.payload.status === 'authoring',
            ),
            'B should start authoring',
        );
        assert.ok(
            facts.some(
                (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'C' && f.payload.status === 'authoring',
            ),
            'C should start authoring',
        );
        assert.ok(
            !facts.some((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'D'),
            'D stays locked (deps B,C not yet terminal)',
        );
    });

    // ── Ported: reactor-failure-paths — step-by-step rejection chain ──

    it('epoch increments on repeat rejections — explicit 2-cycle proof', () => {
        // Cycle 1: epoch=0, reviewed, rejected → authoring epoch=1
        let s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 0, summary: undefined }]);
        let facts = reactState(s);
        let auth = facts.find(
            (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
        );
        assert.ok(auth, '1st: n1 should retry');
        assert.equal(auth.payload.epoch, 1, '1st: epoch bumped to 1');

        // Simulate: n1 is now authoring, went through session, completed, advanced to reviewing, got rejected again
        // Cycle 2: epoch=1, reviewed, rejected → authoring epoch=2
        s = stateWith([{ id: 'n1', status: 'rejected', depends_on: [], epoch: 1, summary: undefined }]);
        facts = reactState(s);
        auth = facts.find(
            (f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1' && f.payload.status === 'authoring',
        );
        assert.ok(auth, '2nd: n1 should retry');
        assert.equal(auth.payload.epoch, 2, '2nd: epoch bumped to 2');
    });

    it('approval: node:phase_advanced with status approved correctly sets node status', () => {
        // The reactor emits node:phase_advanced; the projection applies it.
        // Test the reactor's output contract: completed final-phase session → approved
        const s = stateWith([{ id: 'n1', status: 'reviewing', depends_on: [], epoch: 0, summary: undefined }]);
        s.runtime.sessions['urn:squad:session:n1:v0:p2'] = {
            sessionId: 'urn:squad:session:n1:v0:p2',
            nodeId: 'n1',
            phase: 'reviewing',
            epoch: 0,
            status: 'ended',
            reason: 'completed',
        };
        const facts = reactState(s);
        const adv = facts.filter((f) => f.event === 'node:phase_advanced' && f.payload.nodeId === 'n1');
        assert.equal(adv.length, 1, 'should emit phase_advanced');
        assert.equal(adv[0].payload.status, 'approved', 'final phase → approved');
    });

    // ── Ported: reactor-failure-paths — aborted squad ──

    it('aborted squad returns empty action list', () => {
        const s = stateWith([{ id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined }]);
        s.squad.status = 'aborted';
        const facts = reactState(s);
        assert.equal(facts.length, 0, 'aborted squad produces zero actions');
    });

    it('empty nodes produces no actions', () => {
        const s = getInitialState();
        s.squad = { status: 'active', mode: 'M', originalTask: '' };
        // No nodes at all
        const facts = reactState(s);
        assert.equal(facts.length, 0, 'squad with no nodes produces zero actions');
    });

    // ── Ported: reactor-failure-paths — approval transition ──

    it('completed session with reason error triggers rejection with feedback', () => {
        const s = stateWith([{ id: 'n1', status: 'authoring', depends_on: [], epoch: 0, summary: undefined }]);
        s.runtime.sessions['urn:squad:session:n1:v0:p0'] = {
            sessionId: 'urn:squad:session:n1:v0:p0',
            nodeId: 'n1',
            phase: 'authoring',
            epoch: 0,
            status: 'ended',
            reason: 'error',
            errorMessage: 'LLM crashed',
        };
        const facts = reactState(s);
        const rej = facts.filter((f) => f.event === 'node:rejected' && f.payload.nodeId === 'n1');
        assert.equal(rej.length, 1, 'should emit node:rejected');
        assert.equal(rej[0].payload.feedback, 'LLM crashed', 'feedback propagated');
    });

    // ── Ported: reactor-squad-complete — partial failure ──

    it('M mode n1 approved n2 failed emits squad:complete', () => {
        const log = [
            {
                event: 'squad:init',
                payload: {
                    nodes: [
                        { id: 'n1', depends_on: [] },
                        { id: 'n2', depends_on: [] },
                    ],
                    mode: 'M',
                },
            },
            { event: 'squad:node_state', payload: { nodeId: 'n1', status: 'approved' } },
            { event: 'squad:node_state', payload: { nodeId: 'n2', status: 'failed' } },
        ];
        const state = project(log);
        const facts = reactState(state);
        assert.ok(facts.some((f) => f.event === 'squad:complete'));
    });

    it('L mode __or__ undefined deps terminal unlocks to authoring', () => {
        const log = [
            {
                event: 'squad:init',
                payload: {
                    nodes: [
                        { id: 'n1', depends_on: [] },
                        { id: '__or__', depends_on: ['n1'] },
                    ],
                    mode: 'L',
                },
            },
            { event: 'node:phase_advanced', payload: { nodeId: 'n1', status: 'approved' } },
        ];
        const state = project(log);
        const facts = reactState(state);
        const unlock = facts.filter(
            (f) => f.event === 'squad:node_state' && f.payload.nodeId === '__or__' && f.payload.status === 'authoring',
        );
        assert.equal(unlock.length, 1);
    });

    it('squad:complete idempotent — no actions when already complete', () => {
        const log = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            { event: 'squad:complete', payload: { results: [{ id: 'n1', status: 'approved' }] } },
        ];
        const state = project(log);
        const facts = reactState(state);
        assert.equal(facts.length, 0);
    });
});
