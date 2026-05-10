/**
 * WebSocket model_pool event handlers.
 * @see PRD/05-event-protocol.md §5.6
 * @see PRD/06-model-pool.md §6.3
 */

/**
 * @param {{action:string, slot?:object, index?:number, thinkingLevel?:string}} msg
 * @param {import('./model-pool.js').ModelPool} modelPool
 * @param {object} configModule
 * @param {object} configModule
 * @param {Function} configModule.saveModelsConfig
 * @param {Function} configModule.loadModelsConfig
 */
export async function handleModelPoolMessage(msg, modelPool, configModule, eventBus) {
    const { action, slot, index, thinkingLevel } = msg;
    switch (action) {
        case 'add':
            modelPool.addSlot(slot);
            await configModule.saveModelsConfig(modelPool.getSlots());
            break;
        case 'remove':
            modelPool.removeSlot(index);
            await configModule.saveModelsConfig(modelPool.getSlots());
            break;
        case 'edit':
            if (index === undefined || thinkingLevel === undefined) break;
            modelPool.updateSlotThinkingLevel(index, thinkingLevel);
            await configModule.saveModelsConfig(modelPool.getSlots());
            break;
    }
    if (eventBus) {
        eventBus.emit('model_pool', 'changed', buildSnapshot(modelPool));
    }
}

/**
 * @param {import('./model-pool.js').ModelPool} modelPool
 * @returns {{slots: Array<{provider:string, modelId:string, role:string, thinkingLevel?:string, inUse:boolean}>}}
 */
export function buildSnapshot(modelPool) {
    return {
        slots: modelPool.getSlots().map((s) => ({
            provider: s.provider,
            modelId: s.modelId,
            role: s.role,
            thinkingLevel: s.thinkingLevel,
            inUse: s.inUse,
        })),
    };
}
