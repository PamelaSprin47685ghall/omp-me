/**
 * Engine Simulator (v5 — Zero Content, Flat State) — synchronous time-travel.
 *
 * Drives the pure reactor loop to convergence, simulating side effects
 * (session creation, prompt responses) inline with a promptBehavior hook.
 *
 * No content in state tree. Tool calls stored in flat toolCalls map.
 * Message lifecycle via session:message_start + session:message (legacy).
 */
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';

/**
 * Synchronous Time Traveler.
 * Drives the reactor loop to convergence using fake side effects.
 *
 * @param {Array} initialEvents  - Seed EventLog (array of {event, payload})
 * @param {Function} promptBehavior - (payload) => {status, reason} for fake LLM responses
 * @returns {Array}  Final EventLog after convergence
 */
export function timeTravel(initialEvents, promptBehavior = () => ({ status: 'ok', reason: 'auto' })) {
    const log = {
        a: initialEvents.map((e, i) => ({ id: i, event: e.event || e.type, payload: e.payload })),
        nextId: initialEvents.length,
    };
    function getSince() {
        return log.a;
    }
    function append(type, payload) {
        const o = { id: log.nextId++, event: type, payload };
        log.a.push(o);
        return o;
    }

    for (let i = 0; i < 200; i++) {
        const actions = reactState(project(getSince()));
        if (actions.length === 0) break;

        for (const action of actions) {
            append(action.type, action.payload);

            // Simulate side effects for facts that need async processing
            if (action.type === 'session:creating') {
                append('session:start', {
                    sessionId: action.payload.sessionId,
                    nodeId: action.payload.nodeId,
                    phase: action.payload.phase,
                    retryCount: action.payload.retryCount || 0,
                });
            } else if (action.type === 'session:prompting') {
                append('session:tool_call', {
                    sessionId: action.payload.sessionId,
                    toolName: 'return',
                    toolId: `call-${log.nextId}`,
                    params: promptBehavior(action.payload),
                });
            }
        }
    }

    return getSince();
}

/**
 * Create a seed event array from a squad init payload.
 */
export function initSquad(events) {
    return [{ event: 'squad:init', payload: events }];
}
