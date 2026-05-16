import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { getInitialState, applyEvent, project } from '../../shared/projections.js';

/**
 * mainSessionId is the "North Star" URN — the original session that
 * submitted the plan. It's stored at state.squad.mainSessionId and
 * propagated across all squad:init and squad:replan boundaries.
 */
describe('mainSessionId — plan origin tracking', () => {
    it('getInitialState initializes squad with default status null', () => {
        const s = getInitialState();
        assert.ok(s.squad !== null && s.squad !== undefined, 'squad must be initialized');
        assert.equal(s.squad.status, null);
        assert.equal(s.squad.mode, 'M');
    });

    it('squad:register_main_session stores sessionId', () => {
        const s = applyEvent(getInitialState(), 'squad:register_main_session', { sessionId: 'cli-main' });
        assert.equal(s.squad.mainSessionId, 'cli-main');
    });

    it('squad:register_main_session is idempotent', () => {
        let s = getInitialState();
        s = applyEvent(s, 'squad:register_main_session', { sessionId: 'first' });
        s = applyEvent(s, 'squad:register_main_session', { sessionId: 'second' });
        assert.equal(s.squad.mainSessionId, 'second');
    });

    it('squad:init with mainSessionId carries it forward', () => {
        const log = [
            {
                event: 'squad:init',
                payload: {
                    nodes: [{ id: 'n1', depends_on: [] }],
                    mode: 'M',
                    originalTask: 't',
                    mainSessionId: 'main-42',
                },
            },
        ];
        const s = project(log);
        assert.equal(s.squad.mainSessionId, 'main-42');
    });

    it('squad:replan preserves mainSessionId across topology change', () => {
        const log = [
            {
                event: 'squad:init',
                payload: {
                    nodes: [{ id: 'n1', depends_on: [] }],
                    mode: 'M',
                    originalTask: 't',
                    mainSessionId: 'main-original',
                },
            },
            {
                event: 'squad:replan',
                payload: {
                    nodes: [{ id: 'n2', depends_on: [] }],
                    mode: 'L',
                    originalTask: 'revised',
                    mainSessionId: 'main-original',
                },
            },
        ];
        const s = project(log);
        assert.equal(s.squad.mainSessionId, 'main-original');
    });

    it('squad:phase_changed does not erase mainSessionId', () => {
        const log = [
            { event: 'squad:register_main_session', payload: { sessionId: 'arch-session' } },
            { event: 'squad:phase_changed', payload: { phase: 'revising', feedback: 'needs rework' } },
        ];
        const s = project(log);
        assert.equal(s.squad.mainSessionId, 'arch-session');
    });
});
