/**
 * Engine Simulator (v9) — synchronous time-travel using real pipeline.
 *
 * Uses real EventLog + real reactState + mock EffectHandlers.
 * Handlers return facts instead of appending (PA pattern).
 * Engine appends returned facts after handler resolution.
 *
 * Mock handlers now produce domain facts (node:work_submitted, node:review_decided)
 * instead of raw tool_call:started, matching the real side-effects translation.
 */
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { EventLog } from '../../server/event-log.js';
import { handleToolEnd } from '../../server/side-effects.js';

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

    // Mock EffectHandlers
    const effectHandlers = {
        'session:creating': (payload) => {
            const epoch = payload.epoch;
            return [
                {
                    type: 'session:start',
                    payload: { sessionId: payload.sessionId, nodeId: payload.nodeId, phase: payload.phase, epoch },
                },
            ];
        },
        'session:prompting': (payload) => {
            const result = promptBehavior({
                sessionId: payload.sessionId,
                phase: payload.phase,
                nodeId: payload.nodeId,
            });
            const toolIdx = eventLog.length;

            // tool_call:started must be in log before handleToolEnd reads params
            eventLog.append('tool_call:started', {
                sessionId: payload.sessionId,
                toolName: 'return',
                toolId: `call-${toolIdx}`,
                params: result,
            });

            // Use real handleToolEnd for domain fact elevation (tool_call:finished + node:*)
            // handleToolEnd appends directly to eventLog, just like the production code path.
            handleToolEnd(
                { toolCallId: `call-${toolIdx}`, result, toolName: 'return', isError: false },
                { eventLog, sessionId: payload.sessionId, getState },
            );

            // All facts already appended via direct calls — no return needed
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
