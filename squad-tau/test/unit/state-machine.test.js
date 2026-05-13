import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { transition, emptyState, MAX_RETRIES } from '../../server/state-machine.js';
import { STATUS, EVENT } from '../../server/constants.js';

const S = STATUS;
const E = EVENT;

describe('emptyState', () => {
    it('returns WAITING_DEPS when hasDeps is true', () => {
        const state = emptyState(true);
        assert.deepStrictEqual(state, { status: S.WAITING_DEPS, retryCount: 0 });
    });

    it('returns PENDING when hasDeps is false', () => {
        const state = emptyState(false);
        assert.deepStrictEqual(state, { status: S.PENDING, retryCount: 0 });
    });

    it('defaults hasDeps to false', () => {
        const state = emptyState();
        assert.deepStrictEqual(state, { status: S.PENDING, retryCount: 0 });
    });
});

describe('valid transitions', () => {
    const cases = [
        ['WAITING_DEPS + START → PENDING', S.WAITING_DEPS, E.START, S.PENDING],
        ['WAITING_DEPS + FAIL → FAILED', S.WAITING_DEPS, E.FAIL, S.FAILED],
        ['WAITING_DEPS + BLOCK → BLOCKED', S.WAITING_DEPS, E.BLOCK, S.BLOCKED],
        ['PENDING + START → AUTHORING', S.PENDING, E.START, S.AUTHORING],
        ['PENDING + FAIL → FAILED', S.PENDING, E.FAIL, S.FAILED],
        ['PENDING + BLOCK → BLOCKED', S.PENDING, E.BLOCK, S.BLOCKED],
        ['AUTHORING + WORKER_SUBMIT → CONFIRMING', S.AUTHORING, E.WORKER_SUBMIT, S.CONFIRMING],
        ['AUTHORING + FAIL → FAILED', S.AUTHORING, E.FAIL, S.FAILED],
        ['AUTHORING + BLOCK → BLOCKED', S.AUTHORING, E.BLOCK, S.BLOCKED],
        ['CONFIRMING + CONFIRM → REVIEWING', S.CONFIRMING, E.CONFIRM, S.REVIEWING],
        ['CONFIRMING + FAIL → FAILED', S.CONFIRMING, E.FAIL, S.FAILED],
        ['CONFIRMING + BLOCK → BLOCKED', S.CONFIRMING, E.BLOCK, S.BLOCKED],
        ['REVIEWING + REVIEW_APPROVED → APPROVED', S.REVIEWING, E.REVIEW_APPROVED, S.APPROVED],
        ['REVIEWING + REVIEW_REJECTED → REJECTED', S.REVIEWING, E.REVIEW_REJECTED, S.REJECTED],
        ['REVIEWING + FAIL → FAILED', S.REVIEWING, E.FAIL, S.FAILED],
        ['REVIEWING + BLOCK → BLOCKED', S.REVIEWING, E.BLOCK, S.BLOCKED],
        ['REJECTED + START → AUTHORING', S.REJECTED, E.START, S.AUTHORING],
        ['REJECTED + FAIL → FAILED', S.REJECTED, E.FAIL, S.FAILED],
        ['REJECTED + BLOCK → BLOCKED', S.REJECTED, E.BLOCK, S.BLOCKED],
    ];

    for (const [label, fromStatus, event, expectedStatus] of cases) {
        it(label, () => {
            const result = transition({ status: fromStatus, retryCount: 0 }, event);
            assert.strictEqual(result.status, expectedStatus);
        });
    }
});

describe('illegal transitions return state unchanged', () => {
    const nonTerminalStatuses = [S.WAITING_DEPS, S.PENDING, S.AUTHORING, S.CONFIRMING, S.REVIEWING, S.REJECTED];
    const terminalStatuses = [S.APPROVED, S.BLOCKED, S.FAILED];
    const allStatuses = [...nonTerminalStatuses, ...terminalStatuses];
    const allEvents = Object.values(E);

    const validMap = {
        [S.WAITING_DEPS]: new Set([E.START, E.FAIL, E.BLOCK]),
        [S.PENDING]: new Set([E.START, E.FAIL, E.BLOCK]),
        [S.AUTHORING]: new Set([E.WORKER_SUBMIT, E.FAIL, E.BLOCK]),
        [S.CONFIRMING]: new Set([E.CONFIRM, E.FAIL, E.BLOCK]),
        [S.REVIEWING]: new Set([E.REVIEW_APPROVED, E.REVIEW_REJECTED, E.FAIL, E.BLOCK]),
        [S.REJECTED]: new Set([E.START, E.FAIL, E.BLOCK]),
        [S.APPROVED]: new Set(),
        [S.BLOCKED]: new Set(),
        [S.FAILED]: new Set(),
    };

    for (const status of allStatuses) {
        for (const event of allEvents) {
            if (validMap[status].has(event)) continue;
            it(`${status} + ${event} returns unchanged`, () => {
                const input = { status, retryCount: 3 };
                const result = transition(input, event);
                assert.deepStrictEqual(result, input);
            });
        }
    }
});

describe('retry cycle', () => {
    it('REVIEW_REJECTED increments retryCount', () => {
        const state = { status: S.REVIEWING, retryCount: 0 };
        const result = transition(state, E.REVIEW_REJECTED);
        assert.strictEqual(result.status, S.REJECTED);
        assert.strictEqual(result.retryCount, 1);
    });

    it('accumulates retryCount across multiple rejections', () => {
        let state = { status: S.REVIEWING, retryCount: 0 };
        state = transition(state, E.REVIEW_REJECTED);
        assert.strictEqual(state.retryCount, 1);

        state = transition(state, E.START);
        assert.strictEqual(state.status, S.AUTHORING);
        assert.strictEqual(state.retryCount, 1);

        state = transition(state, E.WORKER_SUBMIT);
        state = transition(state, E.CONFIRM);
        state = transition(state, E.REVIEW_REJECTED);
        assert.strictEqual(state.status, S.REJECTED);
        assert.strictEqual(state.retryCount, 2);
    });

    it('non-rejection events preserve retryCount', () => {
        const result = transition({ status: S.PENDING, retryCount: 5 }, E.START);
        assert.strictEqual(result.retryCount, 5);
    });
});

describe('MAX_RETRIES', () => {
    it('is Infinity (unlimited retries)', () => {
        assert.strictEqual(MAX_RETRIES, Infinity);
    });
});
