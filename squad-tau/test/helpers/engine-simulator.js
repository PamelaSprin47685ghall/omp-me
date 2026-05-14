/**
 * Engine Simulator (v4 — No Model Pool) — synchronous time-travel.
 *
 * Drives the pure reactor loop to convergence, simulating side effects
 * (session creation, prompt responses) inline with a promptBehavior hook.
 *
 * SESSION_CREATING now carries a deterministic sessionId (Cut 2).
 * No MODEL_POOL_ACQUIRE/RELEASE events (Cut 1).
 *
 * Usage:
 *   const log = timeTravel(seedEvents);
 *   const state = project(log);
 *   expect(state.squad.status).toBe('complete');
 */
import { reactState } from '../../server/reactor.js';
import { project } from '../../shared/projections.js';
import { Events } from '../../shared/events.js';

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
            if (action.type === Events.SESSION_CREATING) {
                // sessionId is deterministic — use it directly
                append(Events.SESSION_START, {
                    sessionId: action.payload.sessionId,
                    nodeId: action.payload.nodeId,
                    phase: action.payload.phase,
                });
            } else if (action.type === Events.SESSION_PROMPTING) {
                append(Events.SESSION_TOOL_CALL, {
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
    return [{ event: Events.SQUAD_INIT, payload: events }];
}
