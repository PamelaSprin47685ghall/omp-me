/**
 * Engine Simulator (v8) — synchronous time-travel using real pipeline.
 *
 * Uses real EventLog + real reactState + mock EffectHandlers.
 * Handlers return facts instead of appending (PA pattern).
 * Engine appends returned facts after handler resolution.
 */
import { reactState } from '../../server/reactor.js';
import { applyEvent } from '../../shared/projections.js';
import { project } from '../../shared/projections.js';
import { EventLog } from '../../server/event-log.js';

/**
 * Synchronous Time Traveler.
 * Drives the real reactor + real side-effects pipeline to convergence.
 *
 * @param {Array} initialEvents - Seed events [{ event, payload }, ...]
 * @param {Function} promptBehavior - (phaseContext) => { status, reason }
 * @returns {Array} Full event log entries [{ id, event, payload }]
 */
export function timeTravel(initialEvents, promptBehavior = () => ({ status: 'ok', reason: 'auto' })) {
    const eventLog = new EventLog();
    const getState = () => project(eventLog.log);

    // Mock EffectHandlers: return facts (PA pattern)
    // Mock EffectHandlers: synchronous (return facts directly, no async)
    const effectHandlers = {
        'session:creating': ({ sessionId, nodeId, phase, epoch = 0, retryCount }) => ({
            type: 'session:start',
            payload: { sessionId, nodeId, phase, epoch: epoch ?? retryCount ?? 0 },
        }),
        'session:prompting': ({ sessionId, phase, nodeId }) => {
            const result = promptBehavior({ sessionId, phase, nodeId });
            return {
                type: 'tool_call:started',
                payload: { sessionId, toolName: 'return', toolId: `call-${eventLog.length}`, params: result },
            };
        },
    };

    // Append seed events
    for (const e of initialEvents) {
        eventLog.append(e.event || e.type, e.payload);
    }

    // Drive reactor + effects to convergence (synchronous loop)
    for (let i = 0; i < 200; i++) {
        const actions = reactState(getState());
        if (actions.length === 0) break;

        // Append actions from reactor
        for (const action of actions) {
            eventLog.append(action.type, action.payload);
        }

        // Process effect handlers (synchronous in testing)
        for (const action of actions) {
            const handler = effectHandlers[action.type];
            if (!handler) continue;
            const result = handler(action.payload, { broadcast: null });
            if (result) {
                const facts = Array.isArray(result) ? result : [result];
                for (const f of facts) {
                    eventLog.append(f.type, f.payload);
                }
            }
        }
    }

    return eventLog.log;
}

export function initSquad(events) {
    return [{ event: 'squad:init', payload: events }];
}
