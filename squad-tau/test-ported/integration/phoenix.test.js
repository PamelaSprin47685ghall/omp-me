import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { bootstrap } from '../../server/bootstrap.js';
import { project, getInitialState } from '../../shared/projections.js';
import { reactState } from '../../server/reactor.js';

describe('Phoenix Bootstrap — Crash Immunity', () => {
    it('bootstraps from empty entries to absolute zero state', () => {
        const { eventLog, state } = bootstrap([]);
        assert.equal(eventLog.length, 0);
        assert.deepEqual(state, getInitialState());
    });

    it('produces identical state from serialised EventLog entries', () => {
        // Build 50 facts representing a complex squad lifecycle
        const entries = [];
        entries.push({
            event: 'squad:init',
            payload: {
                nodes: [
                    { id: 'n1', depends_on: [] },
                    { id: 'n2', depends_on: ['n1'] },
                    { id: 'n3', depends_on: ['n2'] },
                ],
                mode: 'M',
            },
        });

        // Simulate n1 lifecycle
        entries.push({
            event: 'session:pending_creation',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
        });
        entries.push({
            event: 'session:start',
            payload: {
                sessionId: 'urn:squad:session:n1:v0:p0',
                nodeId: 'n1',
                epoch: 0,
                phase: 'authoring',
                model: 'gpt-4',
            },
        });
        entries.push({
            event: 'session:end',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', reason: 'completed' },
        });
        entries.push({
            event: 'node:phase_advanced',
            payload: { nodeId: 'n1', status: 'confirming', sessionId: 'urn:squad:session:n1:v0:p0' },
        });

        // n1 confirming phase
        entries.push({
            event: 'session:pending_creation',
            payload: { sessionId: 'urn:squad:session:n1:v0:p1', nodeId: 'n1', phase: 'confirming', epoch: 0 },
        });
        entries.push({
            event: 'session:start',
            payload: {
                sessionId: 'urn:squad:session:n1:v0:p1',
                nodeId: 'n1',
                epoch: 0,
                phase: 'confirming',
                model: 'gpt-4',
            },
        });
        entries.push({
            event: 'session:end',
            payload: { sessionId: 'urn:squad:session:n1:v0:p1', reason: 'completed' },
        });
        entries.push({
            event: 'node:phase_advanced',
            payload: { nodeId: 'n1', status: 'reviewing', sessionId: 'urn:squad:session:n1:v0:p1' },
        });

        // n1 reviewing phase
        entries.push({
            event: 'session:pending_creation',
            payload: { sessionId: 'urn:squad:session:n1:v0:p2', nodeId: 'n1', phase: 'reviewing', epoch: 0 },
        });
        entries.push({
            event: 'session:start',
            payload: {
                sessionId: 'urn:squad:session:n1:v0:p2',
                nodeId: 'n1',
                epoch: 0,
                phase: 'reviewing',
                model: 'gpt-4',
            },
        });
        entries.push({
            event: 'session:end',
            payload: { sessionId: 'urn:squad:session:n1:v0:p2', reason: 'completed' },
        });
        entries.push({
            event: 'node:phase_advanced',
            payload: { nodeId: 'n1', status: 'approved', sessionId: 'urn:squad:session:n1:v0:p2' },
        });

        // n2 lifecycle (now unlocked)
        entries.push({
            event: 'session:pending_creation',
            payload: { sessionId: 'urn:squad:session:n2:v0:p0', nodeId: 'n2', phase: 'authoring', epoch: 0 },
        });
        entries.push({
            event: 'session:start',
            payload: {
                sessionId: 'urn:squad:session:n2:v0:p0',
                nodeId: 'n2',
                epoch: 0,
                phase: 'authoring',
                model: 'gpt-4',
            },
        });
        entries.push({
            event: 'session:end',
            payload: { sessionId: 'urn:squad:session:n2:v0:p0', reason: 'completed' },
        });
        entries.push({
            event: 'node:phase_advanced',
            payload: { nodeId: 'n2', status: 'approved', sessionId: 'urn:squad:session:n2:v0:p0' },
        });

        // n3 lifecycle
        entries.push({
            event: 'session:pending_creation',
            payload: { sessionId: 'urn:squad:session:n3:v0:p0', nodeId: 'n3', phase: 'authoring', epoch: 0 },
        });
        entries.push({
            event: 'session:start',
            payload: {
                sessionId: 'urn:squad:session:n3:v0:p0',
                nodeId: 'n3',
                epoch: 0,
                phase: 'authoring',
                model: 'gpt-4',
            },
        });
        entries.push({
            event: 'session:end',
            payload: { sessionId: 'urn:squad:session:n3:v0:p0', reason: 'completed' },
        });
        entries.push({
            event: 'node:phase_advanced',
            payload: { nodeId: 'n3', status: 'approved', sessionId: 'urn:squad:session:n3:v0:p0' },
        });

        // Terminal
        entries.push({
            event: 'squad:complete',
            payload: {
                results: [
                    { id: 'n1', status: 'approved', summary: 'OK' },
                    { id: 'n2', status: 'approved', summary: 'OK' },
                    { id: 'n3', status: 'approved', summary: 'OK' },
                ],
            },
        });

        // Bootstrap from these entries
        const originalState = project(entries);
        const { eventLog, state: rehydratedState } = bootstrap(entries);

        // The serialised entries should produce identical final state
        assert.deepEqual(rehydratedState, originalState, 'rehydrated state must deep-equal original projected state');

        // Log length must match entry count
        assert.equal(eventLog.length, entries.length);
    });

    it('JSON round-trip preserves state after NDJSON serialisation', () => {
        const entries = [];
        entries.push({
            event: 'squad:init',
            payload: {
                nodes: [
                    { id: 'n1', depends_on: [] },
                    { id: 'n2', depends_on: [] },
                ],
                mode: 'M',
            },
        });
        entries.push({
            event: 'session:pending_creation',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
        });
        entries.push({
            event: 'session:start',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', epoch: 0, phase: 'authoring' },
        });
        entries.push({
            event: 'session:end',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', reason: 'completed' },
        });

        // Serialise to NDJSON strings (as persistence.js does)
        const ndjsonLines = entries.map((e) => JSON.stringify(e));
        const parsedBack = ndjsonLines.map((line) => JSON.parse(line));

        const originalState = project(entries);
        const { state: rehydratedState } = bootstrap(parsedBack);

        // NDJSON serialisation (stringify + parse) must produce identical state
        assert.deepEqual(rehydratedState, originalState, 'NDJSON round-trip must preserve state identity');
    });

    it('cold-start invariant: reactor produces identical actions after crash → rehydrate', () => {
        // Simulate a full lifecycle: init → sessions → complete
        const entries = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            {
                event: 'session:pending_creation',
                payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
            },
            {
                event: 'session:start',
                payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', epoch: 0, phase: 'authoring' },
            },
            { event: 'session:end', payload: { sessionId: 'urn:squad:session:n1:v0:p0', reason: 'completed' } },
            {
                event: 'node:phase_advanced',
                payload: { nodeId: 'n1', status: 'approved', sessionId: 'urn:squad:session:n1:v0:p0' },
            },
            { event: 'squad:complete', payload: { results: [{ id: 'n1', status: 'approved' }] } },
        ];

        // Before crash: project + reactor
        const preState = project(entries);
        const preActions = reactState(preState);

        // Crash! Write NDJSON, reload, bootstrap
        const ndjson = entries.map((e) => JSON.stringify(e));
        const { state: postState } = bootstrap(ndjson.map((line) => JSON.parse(line)));

        // After crash: same project + same reactor
        const postActions = reactState(postState);

        // Assert: both state and actions are identical
        assert.deepEqual(postState, preState, 'bootstrap must produce identical state after crash');
        assert.deepEqual(postActions, preActions, 'reactor must produce identical actions after crash → rehydrate');

        // squad:complete → zero reactor actions (quiescent state)
        assert.equal(preActions.length, 0, 'completed squad must produce zero reactor actions');
    });

    it('loads state with active sessions preserved', () => {
        const entries = [];
        entries.push({
            event: 'squad:init',
            payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' },
        });
        entries.push({
            event: 'session:pending_creation',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
        });
        entries.push({
            event: 'session:start',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', epoch: 0, phase: 'authoring' },
        });
        entries.push({
            event: 'session:end',
            payload: { sessionId: 'urn:squad:session:n1:v0:p0', reason: 'completed' },
        });
        entries.push({
            event: 'node:phase_advanced',
            payload: { nodeId: 'n1', status: 'approved', sessionId: 'urn:squad:session:n1:v0:p0' },
        });
        entries.push({ event: 'squad:complete', payload: { results: [{ id: 'n1', status: 'approved' }] } });

        const { state } = bootstrap(entries);
        assert.equal(state.squad.status, 'complete');
        assert.equal(state.nodes.n1.status, 'approved');
        assert.equal(state.runtime.sessions['urn:squad:session:n1:v0:p0'].status, 'ended');
    });
});
