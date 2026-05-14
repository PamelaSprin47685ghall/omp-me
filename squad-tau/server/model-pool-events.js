/**
 * Model pool message handlers — direct EventLog operations.
 * No ModelPool class: operations are just event append + file persist.
 */
import { Events } from '../shared/events.js';

/**
 * Handle a model pool config message from WebSocket.
 * Applies the action to EventLog and persists to disk.
 *
 * @param {{action:string, slot?:object, slotId?:string, thinkingLevel?:string}} msg
 * @param {object} eventLog
 * @param {object} configModule — { loadModelsConfig, saveModelsConfig }
 */
export async function handleModelPoolMessage(msg, configModule, eventLog, getState) {
    const { action, slot, slotId, thinkingLevel } = msg;
    switch (action) {
        case 'add':
            eventLog.append(Events.MODEL_POOL_CONFIG_UPDATE, {
                action: 'add',
                slot: {
                    ...slot,
                    slotId: slot.slotId || `slot-${slot.role}-${Date.now()}`,
                },
            });
            break;
        case 'remove':
            eventLog.append(Events.MODEL_POOL_CONFIG_UPDATE, { action: 'remove', slotId });
            break;
        case 'edit':
            if (!slotId || thinkingLevel === undefined) break;
            eventLog.append(Events.MODEL_POOL_CONFIG_UPDATE, {
                action: 'edit',
                slotId,
                thinkingLevel,
            });
            break;
    }
    // Persist current slot list to disk
    const state = getState();
    await configModule.saveModelsConfig(state.modelPool.slots);
}

/**
 * Build snapshot object from projected state.
 */
export function buildSnapshot(state) {
    return {
        slots: state.modelPool.slots.map((s) => ({
            slotId: s.slotId,
            provider: s.provider,
            modelId: s.modelId,
            role: s.role,
            thinkingLevel: s.thinkingLevel,
            inUse: !!state.modelPool.usage[s.slotId],
        })),
    };
}
