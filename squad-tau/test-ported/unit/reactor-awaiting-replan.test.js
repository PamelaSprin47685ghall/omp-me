import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { reactState } from '../../server/reactor.js';
import { getInitialState, project, applyEvent } from '../../shared/projections.js';

/**
 * awaiting_replan: a node-level "freeze" state that prevents the reactor
 * from re-emitting rejected facts in an infinite loop.
 *
 * When a node has planConfig.resetOnRej = true and its session ends with
 * error, the reactor must NOT re-trigger R4 (which would auto-retry).
 * Instead, the node enters awaiting_replan — a terminal state that
 * produces ZERO reactor facts. Only an external squad:replan fact
 * (from processDelegate) thaws it.
 */
describe('awaiting_replan — anti-infinite-loop barrier', () => {
    it('resetOnRej rejected → awaiting_replan, not rejected, not authoring', () => {
        const log = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            { event: 'squad:node_state', payload: { nodeId: 'n1', status: 'rejected', epoch: 0 } },
        ];
        const state = project(log);
        state.squad.planConfig = { n1: { resetOnRej: true } };
        const facts = reactState(state);
        const nodeFacts = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n1');
        assert.equal(nodeFacts.length, 1);
        assert.equal(nodeFacts[0].payload.status, 'awaiting_replan');
        assert.ok(!facts.some((f) => f.event === 'squad:node_state' && f.payload.status === 'rejected'));
        assert.ok(!facts.some((f) => f.event === 'squad:node_state' && f.payload.status === 'authoring'));
    });

    it('awaiting_replan is terminal — reactState returns empty array on re-run', () => {
        const log = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            { event: 'squad:node_state', payload: { nodeId: 'n1', status: 'awaiting_replan', epoch: 1 } },
        ];
        const state = project(log);
        state.squad.planConfig = { n1: { resetOnRej: true } };
        const facts = reactState(state);
        assert.equal(facts.length, 0);
    });

    it('awaiting_replan prevents downstream node unlock', () => {
        const log = [
            {
                event: 'squad:init',
                payload: {
                    nodes: [
                        { id: 'n1', depends_on: [] },
                        { id: 'n2', depends_on: ['n1'] },
                    ],
                    mode: 'M',
                },
            },
            { event: 'squad:node_state', payload: { nodeId: 'n1', status: 'awaiting_replan', epoch: 1 } },
        ];
        const state = project(log);
        state.squad.planConfig = { n1: { resetOnRej: true } };
        const facts = reactState(state);
        const n2Unlock = facts.filter((f) => f.event === 'squad:node_state' && f.payload.nodeId === 'n2');
        assert.equal(n2Unlock.length, 0);
    });

    it('awaiting_replan blocked is idempotent across multiple reactState calls', () => {
        const log = [
            {
                event: 'squad:init',
                payload: {
                    nodes: [
                        { id: 'n1', depends_on: [] },
                        { id: 'n2', depends_on: ['n1'] },
                    ],
                    mode: 'M',
                },
            },
            { event: 'squad:node_state', payload: { nodeId: 'n1', status: 'awaiting_replan', epoch: 1 } },
        ];
        const state = project(log);
        state.squad.planConfig = { n1: { resetOnRej: true } };
        for (let i = 0; i < 3; i++) {
            const facts = reactState(state);
            assert.equal(facts.length, 0);
        }
    });
});
