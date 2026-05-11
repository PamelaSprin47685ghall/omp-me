import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { INITIAL_STATE } from './useModelPool.js';

function modelPoolReducer(state, action) {
    switch (action.type) {
        case 'model_pool:snapshot':
            return { ...state, slots: action.payload.slots };
        case 'model_pool:changed':
            return { ...state, slots: action.payload.slots };
        default:
            return state;
    }
}

function dispatch(state, type, payload) {
    return modelPoolReducer(state, { type, payload });
}

test('returns initial state', () => {
    assert.deepEqual(INITIAL_STATE, { slots: [], isOpen: false });
});

test('model_pool:snapshot sets slots', () => {
    const slots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', thinkingLevel: 'medium', inUse: false },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer', inUse: true },
    ];
    const state = dispatch(INITIAL_STATE, 'model_pool:snapshot', { slots });
    assert.deepEqual(state.slots, slots);
});

test('model_pool:changed updates slots', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }],
        isOpen: false,
    };
    const newSlots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: true },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer', inUse: false },
    ];
    const state = dispatch(initial, 'model_pool:changed', { slots: newSlots });
    assert.deepEqual(state.slots, newSlots);
});

test('model_pool:snapshot replaces existing slots', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: true }],
        isOpen: false,
    };
    const newSlots = [{ provider: 'openai', modelId: 'gpt-4', role: 'reviewer', inUse: false }];
    const state = dispatch(initial, 'model_pool:snapshot', { slots: newSlots });
    assert.deepEqual(state.slots, newSlots);
    assert.equal(state.slots.length, 1);
});

test('model_pool:changed handles empty slots', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }],
        isOpen: false,
    };
    const state = dispatch(initial, 'model_pool:changed', { slots: [] });
    assert.deepEqual(state.slots, []);
});

test('unknown action type returns state unchanged', () => {
    const initial = {
        slots: [{ provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false }],
    };
    const state = dispatch(initial, 'UNKNOWN_ACTION', {});
    assert.deepEqual(state, initial);
});

test('model_pool:snapshot with multiple slots preserves order', () => {
    const slots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', inUse: false },
        { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer', inUse: false },
        { provider: 'openai', modelId: 'gpt-4', role: 'worker', thinkingLevel: 'high', inUse: true },
    ];
    const state = dispatch(INITIAL_STATE, 'model_pool:snapshot', { slots });
    assert.deepEqual(state.slots, slots);
    assert.equal(state.slots[0].provider, 'anthropic');
    assert.equal(state.slots[2].provider, 'openai');
});

test('model_pool:changed preserves slot properties', () => {
    const slots = [
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', thinkingLevel: 'medium', inUse: true },
    ];
    const state = dispatch(INITIAL_STATE, 'model_pool:changed', { slots });
    assert.equal(state.slots[0].thinkingLevel, 'medium');
    assert.equal(state.slots[0].inUse, true);
});
