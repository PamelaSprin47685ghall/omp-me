/**
 * The Squad-Tau Engine (v3 — Pure Fact Pipeline).
 *
 * Event-driven pulse: fact appended → incrementally fold into State →
 * debounced microtask → react(state) → Action[] → append all to EventLog.
 *
 * Every reactor output is appended directly to EventLog — no CMD_ routing.
 * Side-effects are wired as EventLog subscribers and react to facts they
 * care about (SESSION_CREATING, SESSION_PROMPTING, user messages).
 */
import { reactState } from './reactor.js';
import { setupSideEffects } from './side-effects.js';
import { applyEvent, getInitialState } from '../shared/projections.js';

export function setupEngine(eventLog, pi) {
    let state = getInitialState();
    let dirty = false;

    // Incremental fold: update state as events arrive
    const unsubLog = eventLog.subscribe((entry) => {
        applyEvent(state, entry.event, entry.payload);
    });

    // Debounced pulse: microtask batch
    const unsubPulse = eventLog.subscribe(() => {
        if (!dirty) {
            dirty = true;
            queueMicrotask(() => {
                dirty = false;
                pulse();
            });
        }
    });

    // Wire side-effects as EventLog subscribers
    const unsubSideEffects = setupSideEffects(eventLog, pi, () => state);

    const getState = () => state;

    function pulse() {
        const actions = reactState(state);
        for (const action of actions) {
            eventLog.append(action.type, action.payload);
        }
    }

    return {
        cleanup: () => {
            unsubLog();
            unsubPulse();
            unsubSideEffects();
        },
        getState: () => state,
    };
}
