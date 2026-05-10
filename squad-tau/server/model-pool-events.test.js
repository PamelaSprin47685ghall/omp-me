import { strict as assert } from 'node:assert';
import { test, beforeEach, describe } from 'node:test';
import { handleModelPoolMessage, buildSnapshot } from './model-pool-events.js';
import { ModelPool } from './model-pool.js';

const fakeConfig = [
    { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', role: 'worker', thinkingLevel: 'medium' },
    { provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022', role: 'reviewer', thinkingLevel: 'off' },
];

describe('handleModelPoolMessage', () => {
    test('add calls modelPool.addSlot then saveModelsConfig', async () => {
        const modelPool = new ModelPool([]);
        let savedSlots;
        const configModule = {
            saveModelsConfig: async (slots) => {
                savedSlots = slots;
            },
            loadModelsConfig: async () => [],
        };
        const slot = { provider: 'ollama', modelId: 'llama3', role: 'worker', thinkingLevel: 'off' };
        await handleModelPoolMessage({ action: 'add', slot }, modelPool, configModule);
        const slots = modelPool.getSlots();
        const added = slots.find((s) => s.modelId === 'llama3');
        assert(added, 'slot should be added');
        assert.deepStrictEqual(savedSlots, slots);
    });

    test('remove calls modelPool.removeSlot then saveModelsConfig', async () => {
        const modelPool = new ModelPool(fakeConfig);
        let savedSlots;
        const configModule = {
            saveModelsConfig: async (slots) => {
                savedSlots = slots;
            },
            loadModelsConfig: async () => [],
        };
        await handleModelPoolMessage({ action: 'remove', index: 0 }, modelPool, configModule);
        assert.deepStrictEqual(savedSlots, modelPool.getSlots());
    });

    test('edit updates thinkingLevel only without persisting', async () => {
        const modelPool = new ModelPool(fakeConfig);
        let savedSlots;
        const configModule = {
            saveModelsConfig: async (slots) => {
                savedSlots = slots;
            },
            loadModelsConfig: async () => [],
        };
        await handleModelPoolMessage({ action: 'edit', index: 0, thinkingLevel: 'high' }, modelPool, configModule);
        assert.strictEqual(modelPool.getSlots()[0].thinkingLevel, 'high');
        assert.strictEqual(savedSlots, undefined);
    });

    test('edit ignores missing index or thinkingLevel', async () => {
        const modelPool = new ModelPool(fakeConfig);
        let savedSlots;
        const configModule = {
            saveModelsConfig: async (slots) => {
                savedSlots = slots;
            },
            loadModelsConfig: async () => [],
        };
        await handleModelPoolMessage({ action: 'edit', index: 0 }, modelPool, configModule);
        await handleModelPoolMessage({ action: 'edit', thinkingLevel: 'high' }, modelPool, configModule);
        assert.strictEqual(savedSlots, undefined);
    });
});

describe('buildSnapshot', () => {
    test('returns slots with provider, modelId, role, thinkingLevel, inUse', () => {
        const modelPool = new ModelPool(fakeConfig);
        const snap = buildSnapshot(modelPool);
        assert.strictEqual(snap.slots.length, 2);
        assert.deepStrictEqual(snap.slots[0], {
            provider: 'anthropic',
            modelId: 'claude-3-5-sonnet-20241022',
            role: 'worker',
            thinkingLevel: 'medium',
            inUse: false,
        });
        assert.deepStrictEqual(snap.slots[1], {
            provider: 'anthropic',
            modelId: 'claude-3-5-haiku-20241022',
            role: 'reviewer',
            thinkingLevel: 'off',
            inUse: false,
        });
    });
});
