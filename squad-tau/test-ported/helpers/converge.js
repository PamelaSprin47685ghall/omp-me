/**
 * converge() — Pure spacetime folder / convergence loop.
 *
 * Given initial events and a side-effect map, runs the full
 * reactor→side-effect loop until quiescence.  All side effects are
 * synchronous fact generation — no timers, no scheduling, no Engine object.
 *
 * ── Outer Loop (side-effect cycle) ──
 *   1. Fold EventLog → State via project()
 *   2. Run INNER loop: repeatedly call reactState + applyEvent in memory
 *      until no more facts are produced (same-tick rule cascade, matching
 *      PulseEngine._converge() semantics).
 *   3. If empty → converged.  Break.
 *   4. Append consolidated batch to EventLog via appendBatch().
 *   5. For each fact with a matching side-effect handler:
 *      Call handler(payload, emit) which may emit new facts via emit().
 *   6. Go to 1
 *
 * @param {Array<{event:string, payload:object}>} initialEvents
 * @param {Object<string, function>} sideEffectMap
 *   key is event type, value is handler(payload, emit(event, payload)).
 *   emit is synchronous and appends to the running EventLog in-place.
 * @param {number} [maxIterations=200]  safety limit (anti-infinite-loop)
 * @returns {{
 *   state: object,         // final Projected state
 *   log: Array,            // serialised EventLog entries
 *   eventLog: EventLog,    // live EventLog instance (for append after converge)
 *   converged: boolean,    // true if loop terminated normally
 *   iterations: number,    // number of reactor→side-effect cycles
 *   batches: Array<Array>  // every batch the reactor produced
 * }}
 *
 * ── Usage ──
 *   const { state, log } = converge(
 *     [{ event: 'squad:init', payload: { nodes: […], mode: 'M' } }],
 *     { 'session:pending_creation': autoCompleteSessions },
 *   );
 *   assert.equal(state.squad.status, 'complete');
 */
import { EventLog } from '../../server/event-log.js';
import { reactState } from '../../server/reactor.js';
import { project, applyEvent } from '../../shared/projections.js';

export function converge(initialEvents = [], sideEffectMap = {}, maxIterations = 200) {
    const eventLog = new EventLog();

    for (const e of initialEvents) {
        eventLog.append(e.event, e.payload);
    }

    const batches = [];
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;
        let state = project(eventLog.getLog());
        const batch = [];

        // ── Inner loop: converge reactor to quiescence in one tick ──
        // Matches PulseEngine._converge(): rules cascade in memory
        // (R3 sees rejected → R5 resets → R2 creates sessions all in one batch).
        while (true) {
            const facts = reactState(state);
            if (facts.length === 0) break;
            for (const f of facts) {
                state = applyEvent(state, f.event, f.payload);
                batch.push(f);
            }
        }

        if (batch.length === 0) break;

        eventLog.appendBatch(batch);
        batches.push(batch);

        // Apply side effects for this batch — uses emit() to append facts
        for (const f of batch) {
            const handler = sideEffectMap[f.event];
            if (handler) {
                handler(f.payload, (event, payload) => {
                    eventLog.append(event, payload);
                });
            }
        }
    }

    return {
        state: project(eventLog.getLog()),
        log: eventLog.getLog(),
        eventLog,
        converged: iterations <= maxIterations,
        iterations,
        batches,
    };
}

// ── Standard side-effect simulators ──

/**
 * Standard session lifecycle: pending_creation → start → end(completed).
 * Use as the default side-effect in most engine-level tests.
 */
export function autoCompleteSessions(payload, emit) {
    if (!payload || !payload.sessionId) return;
    emit('session:start', {
        sessionId: payload.sessionId,
        nodeId: payload.nodeId,
        epoch: payload.epoch,
        phase: payload.phase,
        model: 'simulated',
    });
    emit('session:end', {
        sessionId: payload.sessionId,
        reason: 'completed',
    });
}

/**
 * Session lifecycle that always ends with error/rejection.
 * Used to test retry and failure paths.
 */
export function alwaysRejectSessions(payload, emit) {
    if (!payload || !payload.sessionId) return;
    emit('session:start', {
        sessionId: payload.sessionId,
        nodeId: payload.nodeId,
        epoch: payload.epoch,
        phase: payload.phase,
        model: 'simulated',
    });
    emit('session:end', {
        sessionId: payload.sessionId,
        reason: 'error',
        errorMessage: 'test forced rejection',
    });
}

/**
 * Conditional session simulator — delegates to `decider(payload)` which
 * returns 'completed' or 'error' (with optional errorMessage).
 *
 * @param {function} decider — (payload) => 'completed' | { reason: 'error', errorMessage: string }
 */
/**
 * Batch assertion helper — asserts the structure of converge() batches.
 *
 * Each batch is a single reactor tick's worth of facts.
 * The batch count tells you how many side-effect cycles occurred.
 *
 * @param {Array<Array>} batches — from converge().batches
 * @param {number} expectedCount — exact expected number of batches
 * @param {string} [label] — optional label for assertion messages
 */
export function assertBatchCount(batches, expectedCount, label) {
    if (batches.length !== expectedCount) {
        throw new Error(
            `[${label || 'batch'}] expected ${expectedCount} batches, got ${batches.length}. ` +
                `Batch sizes: [${batches.map((b) => b.length).join(', ')}]`,
        );
    }
}

/**
 * Assert that a specific event type appears in a specific batch index.
 * Batch index 0 = first reactor tick after side-effect cycle 0.
 */
export function assertBatchEvent(batches, batchIndex, eventType, label) {
    const batch = batches[batchIndex];
    if (!batch) {
        throw new Error(`[${label || 'batch'}] batch index ${batchIndex} does not exist (${batches.length} batches)`);
    }
    const found = batch.some((f) => f.event === eventType);
    if (!found) {
        throw new Error(
            `[${label || 'batch'}] batch[${batchIndex}] missing event '${eventType}'. ` +
                `Events: [${batch.map((f) => f.event).join(', ')}]`,
        );
    }
}

/**
 * Assert that a specific event type does NOT appear in any batch.
 */
export function assertNoEvent(batches, eventType, label) {
    for (let i = 0; i < batches.length; i++) {
        const found = batches[i].some((f) => f.event === eventType);
        if (found) {
            throw new Error(`[${label || 'batch'}] event '${eventType}' unexpectedly in batch ${i}`);
        }
    }
}

export function conditionalSessions(decider) {
    return (payload, emit) => {
        if (!payload || !payload.sessionId) return;
        emit('session:start', {
            sessionId: payload.sessionId,
            nodeId: payload.nodeId,
            epoch: payload.epoch,
            phase: payload.phase,
            model: 'simulated',
        });
        const decision = decider(payload);
        if (decision === 'completed') {
            emit('session:end', { sessionId: payload.sessionId, reason: 'completed' });
        } else {
            emit('session:end', {
                sessionId: payload.sessionId,
                reason: 'error',
                errorMessage: decision.errorMessage || 'rejected',
            });
        }
    };
}
