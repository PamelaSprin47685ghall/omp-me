import {
  REVIEW_INSTRUCTIONS,
  REVIEWER_NUDGE_PROMPT,
  activateReview,
  addChild,
  clearReviewSessions,
  deactivateReview,
  isReviewActive,
  resolvePendingReview,
  setPendingReview,
  tryLockReview,
  unlockReview,
  getReviewTask,
  setLastFeedback,
} from 'engine/review';
import { readAssistantText } from 'engine/session';

export { isReviewActive, tryLockReview, unlockReview, deactivateReview, clearReviewSessions, getReviewTask, addChild, activateReview, resolvePendingReview, setPendingReview, setLastFeedback };

const LOOP_COMMAND = 'loop';
const REVIEWER_MAX_NUDGES = 3;
const REVIEWER_INITIAL_GRACE_MS = 6000;
const REVIEWER_SUBSEQUENT_GRACE_MS = 10000;

export const LOOP_TOOL_NAMES = ['submit_review', 'submit_review_result'];

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
  if (isReviewActive(sessionId)) {
    notify('loop mode is already active.', 'info');
    return;
  }
  activateLoopMode(pi, sessionId, task, notify);
}

function attachReviewChild(parentSessionId, childSessionId, pendingResolve) {
  addChild(parentSessionId, childSessionId);
  setPendingReview(childSessionId, pendingResolve);
}

function detachReviewChild(parentSessionId, childSessionId) {
  resolvePendingReview(childSessionId, { feedback: 'Review session closed.', terminated: true });
  unlockReview(childSessionId);
}

async function runReviewLoop(pi, sessionId, report, affectedFiles, task, ctx, helpers) {
  const { createChildSession, readAssistantText: readText } = helpers;
  let resolveReview;
  const deferred = new Promise((resolve) => { resolveReview = resolve; });
  const child = await createChildSession(pi, ctx, { toolNames: ['read', 'submit_review_result'] });
  const childSessionId = child.session.sessionManager.getSessionId();

  attachReviewChild(sessionId, childSessionId, resolveReview);

  let nudges = 0;
  try {
    const prompt = [
      REVIEW_INSTRUCTIONS,
      '',
      `=== Change Report ===\n\n${report}`,
      '',
      `=== Affected Files ===\n\n${affectedFiles.join('\n')}`,
      task ? `\n=== Original Task ===\n\n${task}` : '',
    ].join('\n');

    await child.session.prompt(prompt);
    while (nudges < REVIEWER_MAX_NUDGES) {
      const race = await Promise.race([
        deferred.then((value) => ({ type: 'done', value })),
        child.session.waitForIdle().then(() => ({ type: 'idle' })),
      ]);
      if (race.type === 'done') return race.value;
      nudges += 1;
      const graceMs = nudges === 1 ? REVIEWER_INITIAL_GRACE_MS : REVIEWER_SUBSEQUENT_GRACE_MS;
      const afterGrace = await Promise.race([
        deferred.then((value) => ({ type: 'done', value })),
        new Promise((resolve) => setTimeout(() => resolve({ type: 'timeout' }), graceMs)),
      ]);
      if (afterGrace.type === 'done') return afterGrace.value;
      await child.session.prompt(REVIEWER_NUDGE_PROMPT);
    }
    return { feedback: readText(child.session.sessionManager) || 'Reviewer failed to finish.', terminated: true };
  } finally {
    detachReviewChild(sessionId, childSessionId);
    child.session.abort?.();
    child.dispose?.();
  }
}

export function resetReviewStates() {
  clearReviewSessions();
}

export function setPendingReviewStateForTest(sessionId, parentId, pendingPromise) {
  addChild(parentId, sessionId);
  const resolve = typeof pendingPromise === 'function' ? pendingPromise : (result) => pendingPromise.resolve?.(result);
  setPendingReview(sessionId, resolve);
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
      if (!sessionId || !isReviewActive(sessionId)) {
        return { content: [{ type: 'text', text: 'Loop review is not active for this session.' }], isError: true };
      }
      if (!tryLockReview(sessionId)) {
        return { content: [{ type: 'text', text: 'A review is already in progress.' }], isError: true };
      }
      try {
        const result = await runReviewLoop(pi, sessionId, params.report, params.affectedFiles, getReviewTask(sessionId), ctx, helpers);
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
        unlockReview(sessionId);
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
      if (!sessionId) {
        return { content: [{ type: 'text', text: 'No pending review to resolve.' }], isError: true };
      }
      const feedback = typeof params.feedback === 'string' && params.feedback.trim() ? params.feedback : null;
      const resolved = resolvePendingReview(sessionId, { feedback });
      if (!resolved) {
        return { content: [{ type: 'text', text: 'No pending review to resolve.' }], isError: true };
      }
      setLastFeedback(sessionId, feedback);
      return { content: [{ type: 'text', text: feedback == null ? 'Review submitted: accepted.' : 'Review submitted: rejected with feedback.' }], display: false };
    },
  });
}
