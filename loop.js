const reviewStates = new Map();

const LOOP_COMMAND = 'loop';
const REVIEWER_MAX_NUDGES = 3;
const REVIEWER_GRACE_MS = 1500;

const LOOP_REVIEW_INSTRUCTIONS = [
    'You are a code reviewer performing a rigorous review of submitted work.',
    '',
    '# Evaluation Criteria',
    '',
    '1. Does the implementation make full use of language features? Are the correct algorithms and data structures used?',
    '2. Is the implementation no more complex than necessary?',
    '3. Is the program structure elegant and free of redundancy?',
    '4. Are there no oversized files, overly long functions, or avoidable complexity?',
    '5. Are there necessary unit or integration tests?',
    '6. Are there design flaws, logic errors, or best-practice violations?',
    '7. Is the result natural and intuitive for the user or caller?',
    '8. Does it fully satisfy the original task without cutting corners?',
    '',
    'Read the actual affected files before judging.',
    '',
    'Submit your verdict with submit_review_result({ feedback: null }) to accept,',
    'or submit_review_result({ feedback: "specific actionable feedback" }) to reject.',
    'You MUST call submit_review_result before finishing.',
].join('\n');

const LOOP_REVIEW_NUDGE = [
    'You have not submitted your review verdict yet.',
    '',
    'Call submit_review_result now:',
    'submit_review_result({ feedback: null })',
    'submit_review_result({ feedback: "details" })',
].join('\n');

export const LOOP_TOOL_NAMES = ['submit_review', 'submit_review_result'];

function ensureReviewState(sessionId) {
    let state = reviewStates.get(sessionId);
    if (!state) {
        state = { active: false, locked: false, task: '', pending: null, parentId: null, children: new Set() };
        reviewStates.set(sessionId, state);
    }
    return state;
}

export function deactivateReview(sessionId) {
    const state = reviewStates.get(sessionId);
    if (!state) return;
    if (state.parentId) {
        reviewStates.get(state.parentId)?.children.delete(sessionId);
        state.pending?.resolve({ feedback: 'Review session closed.', terminated: true });
        reviewStates.delete(sessionId);
        return;
    }
    for (const childId of state.children) {
        const childState = reviewStates.get(childId);
        childState?.pending?.resolve({ feedback: 'Parent session closed.', terminated: true });
        reviewStates.delete(childId);
    }
    reviewStates.delete(sessionId);
}

export function isReviewActive(sessionId) {
    return reviewStates.get(sessionId)?.active === true;
}

function activateReview(sessionId, task) {
    const state = ensureReviewState(sessionId);
    state.active = true;
    state.locked = false;
    state.task = task;
    state.pending = null;
    state.parentId = null;
}

function tryClaimReviewSlot(sessionId) {
    const state = reviewStates.get(sessionId);
    if (!state || state.locked) return false;
    state.locked = true;
    return true;
}

function releaseReviewSlot(sessionId) {
    const state = reviewStates.get(sessionId);
    if (state) state.locked = false;
}

function activateLoopMode(pi, sessionId, task, notify) {
    activateReview(sessionId, task);
    pi.sendMessage({
        customType: 'kunwei-loop-activate',
        content: [
            `Task (loop): ${task}`,
            '',
            'Loop mode is active.',
            'Complete the task, then call submit_review with a detailed report and affected files.',
            'A reviewer will inspect the work and either accept it or return actionable feedback.',
        ].join('\n'),
        display: true,
    }, { triggerTurn: true });
    notify('loop mode is active. Finish the task and call submit_review.', 'info');
}

function handleLoopCommand(pi, sessionId, task, notify) {
    if (!sessionId) return;
    if (!task) {
        deactivateReview(sessionId);
        notify('loop mode cancelled.', 'info');
        return;
    }
    if (reviewStates.get(sessionId)?.active) {
        notify('loop mode is already active.', 'info');
        return;
    }
    activateLoopMode(pi, sessionId, task, notify);
}

function attachReviewChild(parentSessionId, childSessionId, pending) {
    ensureReviewState(parentSessionId).children.add(childSessionId);
    reviewStates.set(childSessionId, {
        active: false,
        locked: false,
        task: '',
        pending,
        parentId: parentSessionId,
        children: new Set(),
    });
}

function detachReviewChild(parentSessionId, childSessionId) {
    reviewStates.get(parentSessionId)?.children.delete(childSessionId);
    reviewStates.delete(childSessionId);
}

async function runReviewLoop(pi, sessionId, report, affectedFiles, task, ctx, helpers) {
    const { createChildSession, readAssistantText } = helpers;
    const deferred = Promise.withResolvers();
    const child = await createChildSession(pi, ctx, { toolNames: ['read', 'submit_review_result'] });
    const childSessionId = child.session.sessionManager.getSessionId();

    attachReviewChild(sessionId, childSessionId, deferred);

    let nudges = 0;
    try {
        const prompt = [
            LOOP_REVIEW_INSTRUCTIONS,
            '',
            `=== Change Report ===\n\n${report}`,
            '',
            `=== Affected Files ===\n\n${affectedFiles.join('\n')}`,
            task ? `\n=== Original Task ===\n\n${task}` : '',
        ].join('\n');

        await child.session.prompt(prompt);
        while (nudges < REVIEWER_MAX_NUDGES) {
            const race = await Promise.race([
                deferred.promise.then((value) => ({ type: 'done', value })),
                child.session.waitForIdle().then(() => ({ type: 'idle' })),
            ]);
            if (race.type === 'done') return race.value;
            nudges += 1;
            const afterGrace = await Promise.race([
                deferred.promise.then((value) => ({ type: 'done', value })),
                new Promise((resolve) => setTimeout(() => resolve({ type: 'timeout' }), REVIEWER_GRACE_MS)),
            ]);
            if (afterGrace.type === 'done') return afterGrace.value;
            await child.session.prompt(LOOP_REVIEW_NUDGE);
        }
        return { feedback: readAssistantText(child.session.sessionManager) || 'Reviewer failed to finish.', terminated: true };
    } finally {
        detachReviewChild(sessionId, childSessionId);
        child.session.abort?.();
        child.dispose?.();
    }
}

export function resetReviewStates() {
    reviewStates.clear();
}

export function setPendingReviewStateForTest(sessionId, parentId, pending) {
    ensureReviewState(parentId).children.add(sessionId);
    reviewStates.set(sessionId, {
        active: false,
        locked: false,
        task: '',
        pending,
        parentId,
        children: new Set(),
    });
}

export function registerLoopFeatures(pi, helpers) {
    const { getSessionIdFromContext, stringArraySchema } = helpers;

    pi.on('session_shutdown', (_event, ctx) => {
        const sessionId = getSessionIdFromContext(ctx);
        if (sessionId) deactivateReview(sessionId);
    });

    pi.on('input', async (event, ctx) => {
        const text = event.text.trim();
        if (!text.startsWith(`/${LOOP_COMMAND}`)) return;
        const sessionId = getSessionIdFromContext(ctx);
        handleLoopCommand(pi, sessionId, text.slice(LOOP_COMMAND.length + 1).trim(), ctx.ui.notify.bind(ctx.ui));
        return { handled: true };
    });

    pi.registerCommand(LOOP_COMMAND, {
        description: 'Enable loop review mode for the current session',
        handler: async (args, ctx) => {
            const sessionId = getSessionIdFromContext(ctx);
            handleLoopCommand(pi, sessionId, args.trim(), ctx.ui.notify.bind(ctx.ui));
        },
    });

    pi.registerTool({
        name: 'submit_review',
        label: 'Submit Review',
        description: 'Submit work for review while loop mode is active.',
        parameters: pi.typebox.Object({
            report: pi.typebox.String({ description: 'Detailed description of what was changed.' }),
            affectedFiles: stringArraySchema(pi, 'Modified or created file path.'),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const sessionId = getSessionIdFromContext(ctx);
            if (!sessionId || !reviewStates.get(sessionId)?.active) {
                return { content: [{ type: 'text', text: 'Loop review is not active for this session.' }], isError: true };
            }
            if (!tryClaimReviewSlot(sessionId)) {
                return { content: [{ type: 'text', text: 'A review is already in progress.' }], isError: true };
            }
            try {
                const result = await runReviewLoop(pi, sessionId, params.report, params.affectedFiles, reviewStates.get(sessionId)?.task, ctx, helpers);
                if (result.feedback == null) {
                    deactivateReview(sessionId);
                    return { content: [{ type: 'text', text: 'Review passed. Loop mode ended.' }] };
                }
                if (result.terminated) {
                    deactivateReview(sessionId);
                    return { content: [{ type: 'text', text: `Review terminated: ${result.feedback}` }], isError: true };
                }
                return { content: [{ type: 'text', text: `Review feedback:\n\n${result.feedback}` }], isError: true };
            } finally {
                releaseReviewSlot(sessionId);
            }
        },
    });

    pi.registerTool({
        name: 'submit_review_result',
        label: 'Submit Review Result',
        description: 'Submit a reviewer verdict for loop mode review sessions.',
        parameters: pi.typebox.Object({
            feedback: pi.typebox.Optional(pi.typebox.Union([
                pi.typebox.String({ description: 'Pass non-empty text to reject.' }),
                pi.typebox.Null({ description: 'Pass null to accept.' }),
            ])),
        }),
        defaultInactive: true,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const sessionId = getSessionIdFromContext(ctx);
            const state = sessionId ? reviewStates.get(sessionId) : null;
            if (!state?.pending) {
                return { content: [{ type: 'text', text: 'No pending review to resolve.' }], isError: true };
            }
            const feedback = typeof params.feedback === 'string' && params.feedback.trim() ? params.feedback : null;
            state.pending.resolve({ feedback });
            detachReviewChild(state.parentId, sessionId);
            return { content: [{ type: 'text', text: feedback == null ? 'Review submitted: accepted.' : 'Review submitted: rejected with feedback.' }], display: false };
        },
    });
}
