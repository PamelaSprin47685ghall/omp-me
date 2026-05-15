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
            const { sessionId, phase, nodeId } = payload;
            const result = promptBehavior({ sessionId, phase, nodeId });
            const state = getState();
            const node = state.squad.nodes[nodeId];
            const epoch = node?.epoch ?? 0;
            const facts = [];
            const toolIdx = eventLog.length;

            // Record the tool call (same idx for both started and finished)
            facts.push({
                type: 'tool_call:started',
                payload: { sessionId, toolName: 'return', toolId: `call-${toolIdx}`, params: result },
            });
            facts.push({
                type: 'tool_call:finished',
                payload: { toolId: `call-${toolIdx}`, result: result, isError: false },
            });

            // Translate to domain facts (as real side-effects handleToolEnd does)
            if (phase === 'reviewing' || phase === 'outer_review') {
                facts.push({
                    type: 'node:review_decided',
                    payload: {
                        nodeId,
                        sessionId,
                        approved: result.status === 'ok',
                        summary: result.reason || '',
                        affected_files: result.affected_files || [],
                        epoch,
                    },
                });
            } else if (phase === 'authoring' || phase === 'confirming') {
                facts.push({
                    type: 'node:work_submitted',
                    payload: {
                        nodeId,
                        sessionId,
                        summary: result.reason || '',
                        affected_files: result.affected_files || [],
                        epoch,
                    },
                });
            }

            // Close the session — mirrors real side-effects handleToolEnd.
            // Must be AFTER domain facts so node transition folds before slot frees.
            facts.push({
                type: 'session:end',
                payload: { sessionId, reason: 'completed' },
            });

            return facts;
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
