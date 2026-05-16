/**
 * User Steering — R8 reactor rule (session:message → session:pending_prompt).
 *
 * Pure reactor assertions: given a state with pending user messages on an
 * active session, reactState must emit session:pending_prompt and clear
 * the pending messages queue.
 *
 * Tests use converge() with EMPTY side-effect map — we only inspect the
 * reactor's transitional facts. No PulseEngine, no procedural loops.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { project, applyEvent, getInitialState } from '../../shared/projections.js';
import { converge } from '../helpers/converge.js';

describe('User Steering — session:message → session:pending_prompt', () => {
    it('session:message adds to pendingMessages on active session', () => {
        let s = getInitialState();

        s = applyEvent(s, 'squad:init', {
            nodes: [{ id: 'n1', depends_on: [] }],
            mode: 'M',
        });
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
        s = applyEvent(s, 'session:message', {
            sessionId: 'urn:squad:session:n1:v0:p0',
            role: 'user',
            content: [{ type: 'text', text: 'Change direction, do X instead' }],
            messageId: 'usr_001',
        });

        const sess = s.runtime.sessions['urn:squad:session:n1:v0:p0'];
        assert.ok(sess.pendingMessages, 'pendingMessages array exists');
        assert.equal(sess.pendingMessages.length, 1, 'one pending message');
        assert.equal(sess.pendingMessages[0].content[0].text, 'Change direction, do X instead');
        assert.equal(sess.status, 'active', 'session still active');
    });

    it('converge emits session:pending_prompt from steer message', () => {
        const { batches, log } = converge([
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            {
                event: 'session:pending_creation',
                payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
            },
            {
                event: 'session:start',
                payload: {
                    sessionId: 'urn:squad:session:n1:v0:p0',
                    nodeId: 'n1',
                    epoch: 0,
                    phase: 'authoring',
                    model: 'gpt-4',
                },
            },
            {
                event: 'session:message',
                payload: {
                    sessionId: 'urn:squad:session:n1:v0:p0',
                    role: 'user',
                    content: [{ type: 'text', text: 'Steer: use Python instead of JS' }],
                    messageId: 'usr_steer_1',
                },
            },
        ]);

        // R8 should fire in the first batch: session:pending_prompt
        const firstBatch = batches[0];
        assert.ok(firstBatch, 'at least one reactor batch');
        const pendingPrompts = firstBatch.filter((f) => f.event === 'session:pending_prompt');
        assert.equal(pendingPrompts.length, 1, 'exactly one session:pending_prompt emitted');
        assert.equal(pendingPrompts[0].payload.sessionId, 'urn:squad:session:n1:v0:p0');
        assert.equal(pendingPrompts[0].payload.text, 'Steer: use Python instead of JS');

        // After converge, session status → 'prompting', pendingMessages cleared
        const state = project(log);
        const sess = state.runtime.sessions['urn:squad:session:n1:v0:p0'];
        assert.equal(sess.status, 'prompting', 'session status changed to prompting');
        assert.equal(sess.pendingMessages, undefined, 'pendingMessages cleared after processing');
    });

    it('no pending_prompt for sessions without user messages', () => {
        const { batches } = converge([
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
        ]);

        // No user messages → R8 should not fire
        for (const batch of batches) {
            assert.equal(
                batch.filter((f) => f.event === 'session:pending_prompt').length,
                0,
                'no pending_prompt without user message',
            );
        }
    });

    it('does not re-emit pending_prompt for already-processed messages', () => {
        const events = [
            { event: 'squad:init', payload: { nodes: [{ id: 'n1', depends_on: [] }], mode: 'M' } },
            {
                event: 'session:pending_creation',
                payload: { sessionId: 'urn:squad:session:n1:v0:p0', nodeId: 'n1', phase: 'authoring', epoch: 0 },
            },
            {
                event: 'session:start',
                payload: {
                    sessionId: 'urn:squad:session:n1:v0:p0',
                    nodeId: 'n1',
                    epoch: 0,
                    phase: 'authoring',
                    model: 'gpt-4',
                },
            },
            {
                event: 'session:message',
                payload: {
                    sessionId: 'urn:squad:session:n1:v0:p0',
                    role: 'user',
                    content: [{ type: 'text', text: 'Steer msg' }],
                    messageId: 'usr_1',
                },
            },
        ];

        const { batches } = converge(events);

        // R8 fires in first batch (pending_prompt sets session to 'prompting')
        const firstHasPrompt = batches[0] && batches[0].some((f) => f.event === 'session:pending_prompt');
        assert.ok(firstHasPrompt, 'first batch should emit pending_prompt');

        // After session is in 'prompting' status, subsequent batches must NOT re-emit
        for (let i = 1; i < batches.length; i++) {
            assert.equal(
                batches[i].filter((f) => f.event === 'session:pending_prompt').length,
                0,
                `batch ${i} should not re-emit pending_prompt`,
            );
        }
    });
});
