/**
 * PulseEngine — Trampoline convergence loop.
 *
 * On each pulse: fold EventLog → run reactor until quiescent → atomic commit.
 * Subscribes to EventLog for auto-pulse via queueMicrotask coalescing.
 *
 * No Date.now(), no async in the convergence path.
 */
import { reactState } from './reactor.js';
import { applyEvent, project } from '../shared/projections.js';
import { SideEffectsRouter } from './side-effects.js';

/**
 * Create a wired PulseEngine with side-effects pre-registered.
 * Wires session lifecycle and shutdown handlers.
 *
 * @param {EventLog} eventLog
 * @param {object} pi - PluginInstance from OMP
 * @param {number} maxWorkers
 * @param {object} effectHandlers - Optional extra handlers keyed by event type
 * @param {function} broadcastEphemeral - broadcast function for stream events
 * @returns {PulseEngine}
 */
export function setupEngine(eventLog, pi, maxWorkers, effectHandlers = {}, broadcastEphemeral) {
    const router = new SideEffectsRouter();

    // Wire the append callback so side effects can emit facts
    router.setAppend((event, payload) => {
        eventLog.append(event, payload);
    });

    // Register default session prompt side-effect
    router.on('session:pending_prompt', (payload) => {
        if (!payload || !payload.sessionId) return;
        broadcastEphemeral('session:pending_prompt', payload);
    });

    // Register shutdown side-effect — dispose sessions on squad:abort or connection:close
    router.on('squad:abort', () => {
        broadcastEphemeral('squad:abort', { reason: 'server_shutdown' });
    });

    router.on('connection:close', () => {
        broadcastEphemeral('connection:close', { reason: 'server_shutdown' });
    });

    // Register custom effect handlers passed in — wrap with deps
    for (const [type, handler] of Object.entries(effectHandlers)) {
        router.on(type, (payload, append) => {
            const deps = {
                pi,
                getState: () => project(eventLog.getLog()),
                eventLog,
                broadcast: broadcastEphemeral,
                append,
            };
            const result = handler(payload, deps);
            if (result && typeof result.then === 'function') {
                // async handler — fire-and-forget, propagate returned facts
                result
                    .then((resolved) => {
                        if (resolved && resolved.type) append(resolved.type, resolved.payload);
                    })
                    .catch((err) => console.error('[SideEffect]', type, err));
            } else if (result && result.type) {
                append(result.type, result.payload);
            }
        });
    }

    const engine = new PulseEngine(eventLog, router);

    // Store refs for cleanup
    engine._router = router;

    return engine;
}

export class PulseEngine {
    constructor(eventLog, effectRouter) {
        this._eventLog = eventLog;
        this._effectRouter = effectRouter;
        this._pending = false;
        this._scheduled = false;

        // Subscribe to EventLog → schedule pulse on every change
        this._unsub = eventLog.subscribe(() => {
            if (!this._scheduled) {
                this._scheduled = true;
                queueMicrotask(() => this._drain());
            }
        });
    }

    // External trigger: run one full convergence round, return the batch
    pulse() {
        return this._converge();
    }

    _drain() {
        this._scheduled = false;
        if (this._pending) return;
        this._pending = true;
        try {
            const batch = this._converge();
            if (batch.length > 0 && this._effectRouter) {
                for (const f of batch) {
                    this._effectRouter.dispatch(f.event, f.payload);
                }
            }
        } finally {
            this._pending = false;
            // If new events were appended during effect dispatch, schedule another pulse
            if (this._scheduled) {
                queueMicrotask(() => this._drain());
            }
        }
    }

    _converge() {
        let state = project(this._eventLog.getLog());
        const batch = [];

        while (true) {
            const facts = reactState(state);
            if (facts.length === 0) break;
            for (const f of facts) {
                state = applyEvent(state, f.event, f.payload);
                batch.push(f);
            }
        }

        if (batch.length > 0) {
            this._eventLog.appendBatch(batch);
        }
        return batch;
    }

    destroy() {
        this._unsub();
    }
}
