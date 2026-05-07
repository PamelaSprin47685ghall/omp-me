/**
 * Pure state machine for the review loop.
 *
 * States: inactive | running{step,goal,lastSummary?} | confirming{step,goal,lastSummary,reasonDone} | done
 *
 * Events:
 *   start({goal})           — new loop
 *   stop({reason})           — abort/interrupt
 *   next_summary({summary})  — loop_control("next") from running
 *   done_request({summary})  — loop_control("done") from running → confirming
 *   continue({summary})      — loop_control("next") from confirming → running
 *   done_confirm({summary})  — loop_control("done") from confirming → done
 *   advance                  — increment running step
 *   silent_confirm           — LLM ended in confirming without loop_control
 *   reconstruct({state})     — restore from session
 *
 * Effects: { iteration, status, confirmReminder }
 */

export function emptyState() {
    return { status: 'inactive' };
}

export function isInactiveOrDone(state) {
    return state.status === 'inactive' || state.status === 'done';
}

export function transition(state, event) {
    switch (event.type) {
        case 'start':
            return {
                state: { status: 'running', step: 0, goal: event.goal },
                effects: { iteration: true },
            };

        case 'stop': {
            if (isInactiveOrDone(state)) return { state, effects: {} };
            return {
                state: {
                    status: 'done',
                    step: state.step,
                    goal: state.goal,
                    reasonDone: event.reason,
                    lastSummary: state.lastSummary,
                },
                effects: { status: true },
            };
        }

        case 'next_summary': {
            if (state.status !== 'running') return { state, effects: {} };
            return { state: { ...state, lastSummary: event.summary.trim() }, effects: {} };
        }

        case 'done_request': {
            if (state.status !== 'running') return { state, effects: {} };
            const s = event.summary.trim();
            return {
                state: { status: 'confirming', step: state.step, goal: state.goal, reasonDone: s, lastSummary: s },
                effects: {},
            };
        }

        case 'continue': {
            if (state.status !== 'confirming') return { state, effects: {} };
            return {
                state: { status: 'running', step: state.step, goal: state.goal, lastSummary: event.summary.trim() },
                effects: {},
            };
        }

        case 'done_confirm': {
            if (state.status !== 'confirming') return { state, effects: {} };
            const summary = event.summary.trim();
            const reasonDone = state.reasonDone || summary || 'Goal complete';
            return {
                state: {
                    status: 'done',
                    step: state.step,
                    goal: state.goal,
                    reasonDone,
                    lastSummary: summary || state.lastSummary,
                },
                effects: { status: true },
            };
        }

        case 'advance': {
            if (state.status !== 'running') return { state, effects: {} };
            return { state: { ...state, step: state.step + 1 }, effects: { iteration: true } };
        }

        case 'silent_confirm': {
            if (state.status !== 'confirming') return { state, effects: {} };
            return { state, effects: { confirmReminder: true } };
        }

        case 'reconstruct':
            return { state: event.state, effects: {} };

        default:
            return { state, effects: {} };
    }
}
