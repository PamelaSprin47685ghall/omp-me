/**
 * Phoenix — Crash Immunity via Zero-State Bootstrapping.
 *
 * Cold start axiom: load NDJSON truth source → create EventLog → fold state.
 * Before the final entry is folded, the Engine stays silent — zero facts produced.
 * After bootstrap completes, the brain (Reactor) takes over synchronously.
 *
 * No saveSnapshot(), no periodic checkpoint. State is computed exclusively
 * by replaying the EventLog through pure Projections.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../server/event-log.js';
import { project, getInitialState } from '../../shared/projections.js';
import { reactState } from '../../server/reactor.js';

describe('Phoenix — Crash Immunity (Zero-State Bootstrapping)', () => {
    it('empty entries produce absolute zero state', () => {
        const eventLog = new EventLog([]);
        const state = project(eventLog.getLog());
        assert.equal(eventLog.length, 0);
        assert.deepEqual(state, getInitialState());
    });

    it('produces identical state from serialised EventLog entries', () => {
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

        // n2 lifecycle
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
        const eventLog = new EventLog(entries);
        const rehydratedState = project(eventLog.getLog());

        assert.deepEqual(rehydratedState, originalState, 'rehydrated state must deep-equal original projected state');
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

        const ndjsonLines = entries.map((e) => JSON.stringify(e));
        const parsedBack = ndjsonLines.map((line) => JSON.parse(line));

        const originalState = project(entries);
        const eventLog = new EventLog(parsedBack);
        const rehydratedState = project(eventLog.getLog());

        assert.deepEqual(rehydratedState, originalState, 'NDJSON round-trip must preserve state identity');
    });

    it('cold-start invariant: reactor produces identical actions after crash → rehydrate', () => {
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

        const preState = project(entries);
        const preActions = reactState(preState);

        const ndjson = entries.map((e) => JSON.stringify(e));
        const parsedBack = ndjson.map((line) => JSON.parse(line));
        const eventLog = new EventLog(parsedBack);
        const postState = project(eventLog.getLog());
        const postActions = reactState(postState);

        assert.deepEqual(postState, preState, 'bootstrap must produce identical state after crash');
        assert.deepEqual(postActions, preActions, 'reactor must produce identical actions after crash → rehydrate');
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

        const eventLog = new EventLog(entries);
        const state = project(eventLog.getLog());
        assert.equal(state.squad.status, 'complete');
        assert.equal(state.nodes.n1.status, 'approved');
        assert.equal(state.runtime.sessions['urn:squad:session:n1:v0:p0'].status, 'ended');
    });
});
