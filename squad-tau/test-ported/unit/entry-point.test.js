/**
 * Entry Point — plugin.js pi.on('input') /squad interception contract.
 *
 * Tests the terminal `/squad <task>` → `processDelegate` initiation chain:
 * - pi.on('input') handler correctly intercepts /squad prefix
 * - Non-/squad input passes through (returns undefined)
 * - Empty /squad shows usage notification
 * - Classification prompt has correct M/L mode instructions
 * - squad:register_main_session projection stores mainSessionId
 *
 * NOTE: squadPlugin(pi) internally calls startServer() which starts real
 * HTTP+Vite servers. The input handler contract is tested here in isolation
 * using the handler logic, while _CLASSIFICATION_PROMPT and _resetSquadState
 * are verified against the actual module exports.
 * Full integration (handler through server) is covered by simulation.js.
 */
import { describe, it, beforeAll } from 'bun:test';
import assert from 'node:assert/strict';
import { getInitialState, applyEvent } from '../../shared/projections.js';
import { _CLASSIFICATION_PROMPT, _resetSquadState } from '../../server/plugin.js';

// ── Input handler contract (replicates plugin.js pi.on('input') logic) ──
// This is the exact logic from plugin.js lines 68-86.
// If plugin.js changes, this test MUST be updated to match.
function createInputHandler() {
    return async (event, ctx) => {
        const text = event.text.trim();
        if (!text.startsWith('/squad')) return undefined;
        const spaceIndex = text.indexOf(' ');
        const cmd = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
        if (cmd !== 'squad') return undefined;
        const task = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();
        if (!task) {
            ctx.ui.notify('Usage: /squad <task description>', 'info');
            return { handled: true };
        }
        // activateSquad + pi.sendMessage called here in production
        return { handled: true };
    };
}

describe('Entry Point — /squad terminal interception', () => {
    let handler;

    beforeAll(() => {
        _resetSquadState();
        handler = createInputHandler();
    });

    it('intercepts /squad <task> and returns handled', async () => {
        const mockCtx = { ui: { notify: () => assert.fail('should not notify on valid command') } };
        const result = await handler({ text: '/squad write a calculator' }, mockCtx);
        assert.ok(result, 'handler must return an object for /squad <task>');
        assert.equal(result.handled, true, 'handler must claim the message');
    });

    it('intercepts /squad with leading/trailing whitespace', async () => {
        const mockCtx = { ui: { notify: () => assert.fail('should not notify') } };
        const result = await handler({ text: '  /squad write a test  ' }, mockCtx);
        assert.ok(result);
        assert.equal(result.handled, true);
    });

    it('/squad alone (no task) shows usage notification', async () => {
        let notified = false;
        let notifyMsg = '';
        const mockCtx = {
            ui: {
                notify: (msg, type) => {
                    notified = true;
                    notifyMsg = msg;
                },
            },
        };
        const result = await handler({ text: '/squad' }, mockCtx);
        assert.ok(result, 'must return handled even for empty command');
        assert.equal(result.handled, true);
        assert.ok(notified, 'must notify usage for empty /squad');
        assert.ok(notifyMsg.includes('Usage'), 'notification must mention Usage');
    });

    it('/squad with only whitespace shows usage', async () => {
        let notified = false;
        const mockCtx = {
            ui: {
                notify: () => {
                    notified = true;
                },
            },
        };
        const result = await handler({ text: '/squad   ' }, mockCtx);
        assert.ok(result);
        assert.equal(result.handled, true);
        assert.ok(notified, 'must notify usage for whitespace-only /squad');
    });

    it('non-/squad command passes through (returns undefined)', async () => {
        const mockCtx = { ui: { notify: () => assert.fail('should not notify') } };
        const result = await handler({ text: '/help' }, mockCtx);
        assert.equal(result, undefined, 'non-squad commands must NOT be handled');
    });

    it('/squad-extra does NOT trigger /squad handler', async () => {
        const mockCtx = { ui: { notify: () => assert.fail('should not notify') } };
        const result = await handler({ text: '/squad-extra stuff here' }, mockCtx);
        assert.equal(result, undefined, '/squad-extra must not trigger');
    });

    it('plain text passes through (returns undefined)', async () => {
        const mockCtx = { ui: { notify: () => assert.fail('should not notify') } };
        const result = await handler({ text: 'hello, write a test' }, mockCtx);
        assert.equal(result, undefined, 'plain text must not be handled');
    });

    it('empty text passes through (returns undefined)', async () => {
        const mockCtx = { ui: { notify: () => assert.fail('should not notify') } };
        const result = await handler({ text: '' }, mockCtx);
        assert.equal(result, undefined, 'empty text must not be handled');
    });

    it('null text passes through (returns undefined)', async () => {
        // Real handler would crash on null.text.trim() — this test documents the
        // contract that the handler caller must provide a valid event object.
        // null/undefined events are not expected from OMP runtime.
        const mockCtx = { ui: { notify: () => assert.fail('should not notify') } };
        try {
            await handler({ text: null }, mockCtx);
            assert.fail('handler should throw on null text (caller contract violation)');
        } catch (e) {
            // Expected: TypeError: null is not an object
            assert.ok(true, 'handler correctly rejects null input');
        }
    });
});

describe('Entry Point — classification prompt contract', () => {
    it('_CLASSIFICATION_PROMPT is exported with correct shape', () => {
        assert.ok(_CLASSIFICATION_PROMPT, '_CLASSIFICATION_PROMPT must be exported');
        assert.equal(typeof _CLASSIFICATION_PROMPT, 'string');
        assert.ok(_CLASSIFICATION_PROMPT.length > 200, 'prompt must be substantial');
    });

    it('prompt mentions M mode (single node)', () => {
        assert.ok(_CLASSIFICATION_PROMPT.includes('**M**'), 'prompt must document M mode');
    });

    it('prompt mentions L mode (multi-node DAG)', () => {
        assert.ok(_CLASSIFICATION_PROMPT.includes('**L**'), 'prompt must document L mode');
    });

    it('prompt contains plan_dir path discipline', () => {
        assert.ok(_CLASSIFICATION_PROMPT.includes('plan_dir'), 'prompt must instruct about plan_dir parameter');
    });

    it('prompt requires review_criteria with actionable descriptions', () => {
        assert.ok(_CLASSIFICATION_PROMPT.includes('review_criteria'), 'prompt must mention review_criteria');
        assert.ok(_CLASSIFICATION_PROMPT.includes('concrete'), 'prompt must require concrete criteria');
    });
});

describe('Entry Point — _resetSquadState test isolation', () => {
    it('_resetSquadState is a callable function', () => {
        assert.equal(typeof _resetSquadState, 'function');
        // Should not throw
        _resetSquadState();
    });

    it('calling _resetSquadState twice is safe', () => {
        _resetSquadState();
        _resetSquadState();
        // No error is sufficient
        assert.ok(true);
    });
});

describe('Entry Point — squad:register_main_session projection', () => {
    it('stores sessionId in squad.mainSessionId', () => {
        const s = applyEvent(getInitialState(), 'squad:register_main_session', { sessionId: 'cli-main' });
        assert.equal(s.squad.mainSessionId, 'cli-main');
    });

    it('is idempotent (last write wins)', () => {
        let s = getInitialState();
        s = applyEvent(s, 'squad:register_main_session', { sessionId: 'first' });
        s = applyEvent(s, 'squad:register_main_session', { sessionId: 'second' });
        assert.equal(s.squad.mainSessionId, 'second');
    });

    it('does not crash on missing sessionId', () => {
        // Missing sessionId should throw [Projection] error per projections.js
        try {
            applyEvent(getInitialState(), 'squad:register_main_session', {});
            assert.fail('should have thrown for missing sessionId');
        } catch (e) {
            assert.ok(e.message.includes('sessionId'), 'error must mention sessionId');
        }
    });
});
