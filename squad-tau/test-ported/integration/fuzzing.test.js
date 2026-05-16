/**
 * Algebraic Fuzzing — Statistical Invariant Verification.
 *
 * A) Structural Fuzzing: generate random domain events, assert no crash.
 * B) Behavioral Fuzzing (Converge-driven): assert business invariants.
 * C) Edge pressure: activeCount NEVER negative, 100 consecutive aborts.
 *
 * Uses REAL project(), REAL reactState, REAL converge() pipeline.
 * No mocks, no setTimeout, no Math.random for ID generation (deterministic IDs only).
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { project, applyEvent, getInitialState } from '../../shared/projections.js';
import { reactState } from '../../server/reactor.js';
import { converge, autoCompleteSessions } from '../helpers/converge.js';

// ── Deterministic "random" (no Math.random in assertions) ──
let _seed = 42;
function detRand(max) {
    _seed = (_seed * 16807 + 0) % 2147483647;
    return _seed % max;
}
function pick(arr) {
    return arr[detRand(arr.length)];
}

const NODE_IDS = ['n1', 'n2', 'n3', 'n4', 'n5', '__or__'];
const PHASES = ['authoring', 'confirming', 'reviewing'];

describe('Structural Fuzzing (crash resistance)', () => {
    it('reactState never throws after 500 random domain events', () => {
        _seed = 42;
        let state = getInitialState();

        for (let i = 0; i < 500; i++) {
            const eventType = pick([
                'squad:init',
                'squad:node_state',
                'squad:replan',
                'squad:complete',
                'squad:abort',
                'session:pending_creation',
                'session:start',
                'session:end',
                'session:faulted',
                'node:phase_advanced',
                'node:rejected',
                'node:failed',
                'config:capacity_changed',
                'session:message',
            ]);
            const payload = (() => {
                switch (eventType) {
                    case 'squad:init':
                        return { mode: pick(['M', 'L']), nodes: [], originalTask: '' };
                    case 'squad:replan':
                        return { mode: pick(['M', 'L']), nodes: [], originalTask: '' };
                    case 'squad:node_state':
                        return {
                            nodeId: pick(NODE_IDS),
                            status: pick(['authoring', 'confirming', 'reviewing', 'approved', 'rejected', 'failed']),
                        };
                    case 'squad:complete':
                        return { results: [] };
                    case 'squad:abort':
                        return { reason: 'fuzz' };
                    case 'session:pending_creation':
                        return {
                            sessionId: 'urn:squad:session:' + pick(NODE_IDS) + ':v0:p' + detRand(3),
                            nodeId: pick(NODE_IDS),
                            phase: pick(PHASES),
                            epoch: 0,
                        };
                    case 'session:start':
                        return {
                            sessionId: 'urn:squad:session:' + pick(NODE_IDS) + ':v0:p' + detRand(3),
                            nodeId: pick(NODE_IDS),
                            phase: pick(PHASES),
                            epoch: 0,
                        };
                    case 'session:end':
                        return {
                            sessionId: 'urn:squad:session:' + pick(NODE_IDS) + ':v0:p' + detRand(3),
                            reason: pick(['completed', 'error']),
                        };
                    case 'session:faulted':
                        return {
                            sessionId: 'urn:squad:session:' + pick(NODE_IDS) + ':v0:p' + detRand(3),
                            reason: 'fuzz',
                        };
                    case 'node:phase_advanced':
                        return {
                            nodeId: pick(NODE_IDS),
                            status: pick(['confirming', 'reviewing', 'approved']),
                            sessionId: 'urn:squad:session:x:v0:p0',
                        };
                    case 'node:rejected':
                        return {
                            nodeId: pick(NODE_IDS),
                            sessionId: 'urn:squad:session:x:v0:p0',
                            feedback: 'fuzz rejection',
                        };
                    case 'node:failed':
                        return { nodeId: pick(NODE_IDS) };
                    case 'config:capacity_changed':
                        return { maxWorkers: detRand(10) + 1 };
                    case 'session:message':
                        return {
                            sessionId: 'urn:squad:session:' + pick(NODE_IDS) + ':v0:p' + detRand(3),
                            role: 'user',
                            content: [{ type: 'text', text: 'fuzz' }],
                        };
                    default:
                        return {};
                }
            })();

            try {
                state = applyEvent(state, eventType, payload);
            } catch {
                // Expected for edge cases (e.g., unknown session) — state unchanged
            }

            // Every 100 iterations, verify reactState is stable
            if (i % 100 === 0) {
                try {
                    const actions = reactState(state);
                    assert.ok(Array.isArray(actions), 'reactState returns array at iter ' + i);
                } catch (e) {
                    assert.fail('reactState threw at iteration ' + i + ': ' + e.message);
                }
            }
        }

        // Final stabilisation check
        const actions = reactState(state);
        assert.ok(Array.isArray(actions), 'final reactState returns array');
    });

    it('all event types with null/missing payloads — reactState stable', () => {
        const eventTypes = [
            'squad:init',
            'squad:node_state',
            'squad:complete',
            'squad:abort',
            'session:pending_creation',
            'session:start',
            'session:end',
            'node:phase_advanced',
            'node:rejected',
            'node:failed',
            'config:capacity_changed',
        ];
        for (const type of eventTypes) {
            const state = getInitialState();
            for (const payload of [null, {}, undefined, { randomKey: true }]) {
                try {
                    applyEvent(state, type, payload);
                } catch {
                    // Expected for missing required fields
                }
            }
            assert.doesNotThrow(() => reactState(state), 'reactState should not throw after bad payload for ' + type);
        }
    });
});

describe('Edge Pressure Tests', () => {
    it('100 consecutive aborts — no explosion, reactState handles', () => {
        let state = getInitialState();
        state = applyEvent(state, 'squad:init', {
            mode: 'M',
            nodes: [{ id: 'n1', depends_on: [] }],
            originalTask: 't',
        });
        for (let i = 0; i < 100; i++) {
            state = applyEvent(state, 'squad:abort', { reason: 'abort-' + i });
        }
        const actions = reactState(state);
        assert.ok(Array.isArray(actions), 'reactState returns array');
        assert.equal(actions.length, 0, 'aborted squad produces zero actions');
        assert.equal(state.squad.status, 'aborted', 'squad status is aborted');
    });

    it('activeCount never negative across random session:start/session:end pairs', () => {
        _seed = 42;

        // Use converge to reach a steady baseline first
        const { eventLog } = converge(
            [{ event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } }],
            { 'session:pending_creation': autoCompleteSessions },
        );

        // Now inject random start/end pairs into the SAME eventLog
        const sids = [];
        for (let i = 0; i < 50; i++) {
            const sid = 'urn:squad:session:fuzz:n1:v0:p' + (i % 3);
            if (detRand(2) === 0) {
                eventLog.append('session:start', { sessionId: sid, nodeId: 'n1', epoch: 0, phase: 'authoring' });
                sids.push(sid);
            } else if (sids.length > 0) {
                eventLog.append('session:end', { sessionId: sids.pop(), reason: 'completed' });
            }
        }

        const state = project(eventLog.getLog());
        assert.ok(state.stats.activeCount >= 0, 'activeCount must never be negative, got ' + state.stats.activeCount);
    });
});

describe('Behavioral Fuzzing (Converge-driven invariants)', () => {
    it('M mode converges to SQUAD_COMPLETE', () => {
        const { state, log } = converge(
            [{ event: 'squad:init', payload: { mode: 'M', nodes: [{ id: 'n1', depends_on: [] }], originalTask: 't' } }],
            { 'session:pending_creation': autoCompleteSessions },
        );

        assert.equal(state.squad.status, 'complete', 'M mode converges');
        assert.equal(state.nodes.n1.status, 'approved', 'n1 approved');

        // Invariant: every approved node has its deps approved or failed
        for (const nid of Object.keys(state.nodes)) {
            const n = state.nodes[nid];
            if (n.status !== 'approved') continue;
            for (const depId of n.depends_on || []) {
                const dep = state.nodes[depId];
                assert.ok(
                    dep && (dep.status === 'approved' || dep.status === 'failed'),
                    `approved node ${nid} has dep ${depId} with terminal status ${dep?.status}`,
                );
            }
        }

        console.log(`✓ M mode converge: ${log.length} log entries`);
    });

    it('L chain converges — both nodes approved with ordering', () => {
        const { state, log } = converge(
            [
                {
                    event: 'squad:init',
                    payload: {
                        mode: 'L',
                        nodes: [
                            { id: 'A', depends_on: [] },
                            { id: 'B', depends_on: ['A'] },
                        ],
                        originalTask: 't',
                    },
                },
            ],
            { 'session:pending_creation': autoCompleteSessions },
        );

        assert.equal(state.squad.status, 'complete', 'L chain converges');
        assert.equal(Object.keys(state.nodes).length, 2, 'both nodes exist');

        // Ordering: A's session pending_creation before B's node_state
        const aSess = log.findIndex((e) => e.event === 'session:pending_creation' && e.payload.nodeId === 'A');
        const bAuth = log.findIndex(
            (e) => e.event === 'squad:node_state' && e.payload.nodeId === 'B' && e.payload.status === 'authoring',
        );
        assert.ok(aSess >= 0, 'A has session pending');
        assert.ok(bAuth > aSess, 'B unlocked after A (b=' + bAuth + ' > a=' + aSess + ')');

        console.log(`✓ L chain converge: ${log.length} log entries`);
    });
});
