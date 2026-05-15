/**
 * Squad-Tau Engine (v9 — PA + Trampoline, config in state).
 *
 * Convergence loop: f(State) → Action[] → append → repeat until stable.
 * After convergence, fires effect handlers for transitional facts.
 * Handlers return facts which Engine appends — SideEffects never touch EventLog.
 * Unhandled handler errors → session:faulted (first-class faults).
 *
 * Config (maxWorkers) lives in state.config, seeded by config:capacity_changed.
 * No separate env object, no setEnv/getEnv escape hatch.
 *
 * Zero-State Bootstrapping: constructor folds any pre-existing EventLog
 * entries (from .ndjson rehydration) into the initial state before
 * subscribing to new entries. This gives process-crash immunity.
 */
import { reactState } from './reactor.js';
import { applyEvent, getInitialState } from '../shared/projections.js';
import { buildPrompt } from './prompt-builder.js';

export function setupEngine(eventLog, pi, initialMaxWorkers = 3, effectHandlers = {}, broadcastEphemeral = null) {
    let state = getInitialState();

    // Fold any pre-existing entries (e.g. from .ndjson rehydration)
    for (const entry of eventLog.log) {
        state = applyEvent(state, entry.event, entry.payload);
    }

    // Seed config as a domain event (only if not already set from rehydration)
    if (!state.config?.maxWorkers) {
        state = applyEvent(state, 'config:capacity_changed', { maxWorkers: initialMaxWorkers });
    }

    let pendingTick = false;

    // Fold incoming events into state
    const unsubLog = eventLog.subscribe((data) => {
        const list = Array.isArray(data) ? data : [data];
        for (const entry of list) {
            state = applyEvent(state, entry.event, entry.payload);
        }
        if (!pendingTick) {
            pendingTick = true;
            setImmediate(tick);
        }
    });

    const getState = () => state;

    // ── Effect processing ──
    function processEffects(batch) {
        for (const entry of batch) {
            const handler = effectHandlers[entry.event];
            if (!handler) continue;

            let payload = entry.payload;

            // Pre-build prompt text for session:prompting
            if (entry.event === 'session:prompting' && payload) {
                try {
                    const node = state.squad.nodes[payload.nodeId];
                    if (node) {
                        const promptText = buildPrompt(payload.phase, state, node, eventLog);
                        payload = { ...payload, promptText };
                    }
                } catch {
                    // buildPrompt failure is non-fatal; engine continues
                }
            }

            // Fire handler (async, fire-and-forget)
            handler(payload, { pi, getState, eventLog, broadcast: broadcastEphemeral })
                .then((result) => {
                    if (!result) return;
                    const facts = Array.isArray(result) ? result : [result];
                    for (const f of facts) {
                        eventLog.append(f.type, f.payload);
                    }
                })
                .catch((err) => {
                    const sid = payload?.sessionId;
                    if (sid) {
                        eventLog.append('session:faulted', {
                            sessionId: sid,
                            nodeId: payload?.nodeId,
                            reason: 'handler_error',
                            message: err?.message || String(err),
                        });
                    }
                });
        }
    }

    // ── Trampoline tick ──
    function tick() {
        pendingTick = false;
        if (state.squad.status !== 'active') return;

        let convergenceState = state;
        const batch = [];

        while (true) {
            const actions = reactState(convergenceState);
            if (actions.length === 0) break;
            for (const action of actions) {
                convergenceState = applyEvent(convergenceState, action.type, action.payload);
                batch.push(eventLog._makeEntry(action.type, action.payload));
            }
        }

        if (batch.length === 0) return;

        // Atomic emission: all converged facts in one batch
        eventLog.appendBatch(batch);

        // After convergence, process side-effect handlers for transitional facts
        processEffects(batch);
    }

    // ── External input entry point ──
    function absorb(type, payload) {
        const entry = eventLog._makeEntry(type, payload);
        eventLog.appendBatch([entry]);
    }

    return {
        cleanup: () => {
            unsubLog();
        },
        getState,
        absorb,
    };
}
