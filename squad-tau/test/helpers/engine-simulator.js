/**
 * Engine Simulator (v7) — synchronous time-travel using real pipeline.
 *
 * Uses real EventLog + real reactState + real setupSideEffects,
 * *with mocked OMP-dependent handlers for synchronous execution.
 *
 * No manual session:start or tool_call:started injection.
 * Side effects respond to events just like in production.
 */
import { reactState } from '../../server/reactor.js';
import { setupSideEffects } from '../../server/side-effects.js';
import { project } from '../../shared/projections.js';
import { EventLog } from '../../server/event-log.js';

/**
 * Synchronous Time Traveler.
 * Drives the real reactor + real side-effecs pipeline to convergence.
 *
 * @param {Array} initialEvents - Seed events [{ event, payload }, ...]
 * @param {Function} promptBehavior - (phaseContext) => { status, reason }
 * @returns {Array} Full event log entries [{ id, event, payload }]
 */
export function timeTravel(initialEvents, promptBehavior = () => ({ status: 'ok', reason: 'auto' })) {
    const eventLog = new EventLog();
    const getState = () => project(eventLog.log);

    // Mock side-effects: synchronous, no real OMP API calls
    const mockEffects = {
        'session:creating': ({ sessionId, nodeId, phase, retryCount }, { eventLog }) => {
            eventLog.append('session:start', {
                sessionId,
                nodeId,
                phase,
                retryCount: retryCount || 0,
            });
        },
        'session:prompting': ({ sessionId, phase, nodeId }, { eventLog }) => {
            const result = promptBehavior({ sessionId, phase, nodeId });
            eventLog.append('tool_call:started', {
                sessionId,
                toolName: 'return',
                toolId: `call-${eventLog.length}`,
                params: result,
            });
        },
    };

    // Wire real setupSideEffects with mocked handlers
    const cleanup = setupSideEffects(eventLog, null, getState, mockEffects);

    // Append seed events
    for (const e of initialEvents) {
        eventLog.append(e.event || e.type, e.payload);
    }

    // Drive reactor to convergence (synchronous loop)
    for (let i = 0; i < 200; i++) {
        const actions = reactState(getState());
        if (actions.length === 0) break;
        for (const action of actions) {
            eventLog.append(action.type, action.payload);
        }
    }

    cleanup();
    return eventLog.log;
}

export function initSquad(events) {
    return [{ event: 'squad:init', payload: events }];
}
