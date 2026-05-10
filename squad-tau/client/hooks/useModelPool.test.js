import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { INITIAL_STATE } from './useModelPool.js';

function modelPoolReducer(state, action) {
    switch (action.type) {
        case 'MODEL_POOL_SNAPSHOT':
            return { slots: action.payload.slots };
        case 'MODEL_POOL_CHANGED':
            return { slots: action.payload.slots };
        default:
            return state;
    }
}

function dispatch(state, type, payload) {
    return modelPoolReducer(state, { type, payload });
}

test('returns initial state', () => {
    assert.deepEqual(INITIAL_STATE, { slots: [] });
});

test('MODEL_POOL_SNAPSHOT sets slots', () => {
    const slots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', thinkingLevel: 'medium', inUse: false },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer', inUse: true },
    ];
    const state = dispatch(INITIAL_STATE, 'MODEL_POOL_SNAPSHOT', { slots });
    assert.deepEqual(state.slots, slots);
});

test('MODEL_POOL_CHANGED updates slots', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }],
    };
    const newSlots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: true },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer', inUse: false },
    ];
    const state = dispatch(initial, 'MODEL_POOL_CHANGED', { slots: newSlots });
    assert.deepEqual(state.slots, newSlots);
});

test('MODEL_POOL_SNAPSHOT replaces existing slots', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: true }],
    };
    const newSlots = [{ provider: 'openai', modelId: 'gpt-4', role: 'reviewer', inUse: false }];
    const state = dispatch(initial, 'MODEL_POOL_SNAPSHOT', { slots: newSlots });
    assert.deepEqual(state.slots, newSlots);
    assert.equal(state.slots.length, 1);
});

test('MODEL_POOL_CHANGED handles empty slots', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }],
    };
    const state = dispatch(initial, 'MODEL_POOL_CHANGED', { slots: [] });
    assert.deepEqual(state.slots, []);
});

test('unknown action type returns state unchanged', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }],
    };
    const state = dispatch(initial, 'UNKNOWN_ACTION', {});
    assert.deepEqual(state, initial);
});

test('MODEL_POOL_SNAPSHOT with multiple slots preserves order', () => {
    const slots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer', inUse: false },
        { provider: 'openai', modelId: 'gpt-4', role: 'worker', thinkingLevel: 'high', inUse: true },
    ];
    const state = dispatch(INITIAL_STATE, 'MODEL_POOL_SNAPSHOT', { slots });
    assert.deepEqual(state.slots, slots);
    assert.equal(state.slots[0].provider, 'anthropic');
    assert.equal(state.slots[2].provider, 'openai');
});

test('MODEL_POOL_CHANGED preserves slot properties', () => {
    const slots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', thinkingLevel: 'medium', inUse: true },
    ];
    const state = dispatch(INITIAL_STATE, 'MODEL_POOL_CHANGED', { slots });
    assert.equal(state.slots[0].thinkingLevel, 'medium');
    assert.equal(state.slots[0].inUse, true);
});
