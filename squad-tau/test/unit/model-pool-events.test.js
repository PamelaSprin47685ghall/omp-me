import { describe, test, expect, beforeEach } from 'bun:test';
import { ModelPool } from '../../server/model-pool.js';
import { handleModelPoolMessage, buildSnapshot } from '../../server/model-pool-events.js';
import { EventBus } from '../../server/event-bus.js';

describe('buildSnapshot', () => {
    test('returns empty slots array for empty pool', () => {
        const pool = new ModelPool([]);
        const snapshot = buildSnapshot(pool);
        expect(snapshot).toEqual({ slots: [] });
    });

    test('includes all slots with provider, modelId, role, thinkingLevel, inUse', () => {
        const config = [
            { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', thinkingLevel: 'medium' },
            { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer' },
        ];
        const pool = new ModelPool(config);
        const snapshot = buildSnapshot(pool);

        expect(snapshot.slots.length).toBe(2);
        expect(snapshot.slots[0].provider).toBe('anthropic');
        expect(snapshot.slots[0].modelId).toBe('claude-3-5-sonnet');
        expect(snapshot.slots[0].role).toBe('worker');
        expect(snapshot.slots[0].thinkingLevel).toBe('medium');
        expect(snapshot.slots[0].inUse).toBe(false);
    });
});

describe('handleModelPoolMessage', () => {
    let pool;
    let eventBus;
    const configModule = {
        saveModelsConfig: async () => {},
        loadModelsConfig: () => [],
    };

    beforeEach(() => {
        pool = new ModelPool([
            { provider: 'anthropic', modelId: 'claude-3-5-sonnet', role: 'worker', thinkingLevel: 'medium' },
            { provider: 'anthropic', modelId: 'claude-3-5-haiku', role: 'reviewer' },
        ]);
        eventBus = new EventBus();
    });

    test('add: inserts new slot and saves config', async () => {
        const saved = [];
        const localConfig = {
            saveModelsConfig: async (c) => saved.push(c),
            loadModelsConfig: () => [],
        };

        await handleModelPoolMessage(
            { action: 'add', slot: { provider: 'openai', modelId: 'gpt-4', role: 'worker', thinkingLevel: 'high' } },
            pool,
            localConfig,
            eventBus,
        );

        expect(pool.getSlots().length).toBe(3);
        expect(saved.length).toBe(1);
    });

    test('remove: deletes slot and saves config', async () => {
        const saved = [];
        const localConfig = {
            saveModelsConfig: async (c) => saved.push(c),
            loadModelsConfig: () => [],
        };

        await handleModelPoolMessage({ action: 'remove', index: 0 }, pool, localConfig, eventBus);

        expect(pool.getSlots().length).toBe(1);
        expect(saved.length).toBe(1);
    });

    test('edit: updates thinkingLevel', async () => {
        const saved = [];
        const localConfig = {
            saveModelsConfig: async (c) => saved.push(c),
            loadModelsConfig: () => [],
        };

        await handleModelPoolMessage({ action: 'edit', index: 0, thinkingLevel: 'high' }, pool, localConfig, eventBus);

        expect(pool.getSlots()[0].thinkingLevel).toBe('high');
        expect(saved.length).toBe(1);
    });

    test('emits model_pool:changed event', async () => {
        const events = [];
        eventBus.on('*', (payload, type) => {
            if (type === 'model_pool:changed') events.push(payload);
        });

        await handleModelPoolMessage(
            { action: 'add', slot: { provider: 'openai', modelId: 'gpt-4', role: 'worker' } },
            pool,
            configModule,
            eventBus,
        );

        expect(events.length).toBe(1);
        expect(events[0].slots.length).toBe(3);
    });

    test('no eventBus does not throw', async () => {
        await handleModelPoolMessage(
            { action: 'add', slot: { provider: 'openai', modelId: 'gpt-4', role: 'worker' } },
            pool,
            configModule,
            null,
        );
        expect(pool.getSlots().length).toBe(3);
    });

    test('edit without index does nothing', async () => {
        await handleModelPoolMessage({ action: 'edit', thinkingLevel: 'high' }, pool, configModule, eventBus);
        expect(pool.getSlots()[0].thinkingLevel).toBe('medium');
    });

    test('remove invalid index does nothing', async () => {
        const originalLength = pool.getSlots().length;
        await handleModelPoolMessage({ action: 'remove', index: 99 }, pool, configModule, eventBus);
        expect(pool.getSlots().length).toBe(originalLength);
    });
});
