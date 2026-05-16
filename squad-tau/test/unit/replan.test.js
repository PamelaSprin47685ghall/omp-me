import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { project, applyEvent, getInitialState } from '../../shared/projections.js';
import { EventLog } from '../../server/event-log.js';

describe('Replan — Topological Overwrite (squad:replan)', () => {
    it('squad:replan overwrites nodes with new topology', () => {
        let s = getInitialState();

        // Start with 3 nodes
        s = applyEvent(s, 'squad:init', {
            nodes: [
                { id: 'n1', depends_on: [] },
                { id: 'n2', depends_on: ['n1'] },
                { id: 'n3', depends_on: ['n2'] },
            ],
            mode: 'M',
        });

        // Simulate n1 being in progress
        s = applyEvent(s, 'session:pending_creation', {
            sessionId: 'urn:squad:session:n1:v0:p0',
            nodeId: 'n1',
            phase: 'authoring',
            epoch: 0,
        });
        s = applyEvent(s, 'session:start', {
            sessionId: 'urn:squad:session:n1:v0:p0',
            nodeId: 'n1',
            epoch: 0,
            phase: 'authoring',
            model: 'gpt-4',
        });
        s = applyEvent(s, 'session:end', { sessionId: 'urn:squad:session:n1:v0:p0', reason: 'completed' });
        s = applyEvent(s, 'node:phase_advanced', {
            nodeId: 'n1',
            status: 'approved',
            sessionId: 'urn:squad:session:n1:v0:p0',
        });

        // Now replan with only 2 nodes
        s = applyEvent(s, 'squad:replan', {
            nodes: [
                { id: 'a1', depends_on: [] },
                { id: 'a2', depends_on: ['a1'] },
            ],
            mode: 'M',
            originalTask: 'new task',
        });

        // Nodes must be overwritten — only the new 2 nodes exist
        assert.ok(!s.nodes.n1, 'old node n1 must be removed');
        assert.ok(!s.nodes.n2, 'old node n2 must be removed');
        assert.ok(!s.nodes.n3, 'old node n3 must be removed');
        assert.ok(s.nodes.a1, 'new node a1 exists');
        assert.ok(s.nodes.a2, 'new node a2 exists');
        assert.equal(Object.keys(s.nodes).length, 2, 'exactly 2 nodes');

        // New nodes: no-deps get authoring, others undefined
        assert.equal(s.nodes.a1.status, 'authoring', 'a1 auto-unlocked');
        assert.equal(s.nodes.a2.status, undefined, 'a2 waiting on dep');

        // Squad status active
        assert.equal(s.squad.status, 'active', 'squad reactivated');

        // Old sessions preserved in runtime
        assert.ok(
            s.runtime.sessions['urn:squad:session:n1:v0:p0'],
            'old execution history preserved in runtime sessions',
        );
        assert.equal(s.runtime.sessions['urn:squad:session:n1:v0:p0'].status, 'ended');
    });

    it('replan preserves history — EventLog not physically deleted', () => {
        // This test verifies the EventLog truth source retains old events
        const eventLog = new EventLog();

        // Record some history
        eventLog.append('squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
        });
        eventLog.append('squad:replan', {
            nodes: [{ id: 'a1', depends_on: [] }],
            mode: 'M',
            originalTask: 'revised',
        });

        const log = eventLog.getLog();
        assert.equal(log.length, 2, 'both facts in log');
        assert.equal(log[0].event, 'squad:init', 'first event preserved');
        assert.equal(log[1].event, 'squad:replan', 'replan event appended');

        // Projection: state reflects only latest topology, but log has both
        const state = project(log);
        assert.ok(!state.nodes.n1, 'old node gone from projection');
        assert.ok(state.nodes.a1, 'new node in projection');
    });

    it('replan preserves squad mode and originalTask', () => {
        let s = getInitialState();
        s = applyEvent(s, 'squad:init', { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' });
        s = applyEvent(s, 'squad:replan', {
            nodes: [{ id: 'new_n1', depends_on: [] }],
            mode: 'L',
            originalTask: 'revised task',
        });
        assert.equal(s.squad.mode, 'L', 'mode updated to L');
        assert.equal(s.squad.originalTask, 'revised task', 'originalTask preserved');
        assert.equal(s.squad.status, 'active', 'squad active');
    });
});
