import {
  LOOP_NUDGE_PROMPT,
  TODO_NUDGE_PROMPT,
  activateReview,
  addChild,
  clearReviewSessions as _clearReviewSessions,
  deactivateReview,
  getOrCreateAbortSuppressor as _getOrCreateSuppressor,
  isReviewActive,
  resolvePendingReview,
  setLastFeedback,
  setPendingReview,
  tryLockReview,
  unlockReview,
  getReviewTask,
} from 'engine/review';
import { getLatestTodoPhasesFromEntries, readAssistantText } from 'engine/session';
import { TODO_NUDGE_CHECK_TAG, hasOpenTodos } from 'engine/todo';
import { buildRunnerNudgePrompt } from 'engine/runner';

const TERMINAL_TODO_STATUSES = new Set(['completed', 'cancelled', 'abandoned']);

function flattenTodoTasks(phases) {
  return phases.flatMap((phase) => phase.tasks || []);
}

function currentEntryCount(sessionManager) {
  return sessionManager.getEntries?.()?.length ?? 0;
}

function alreadySkippedSince(sessionManager, marker, sinceIndex) {
  return Boolean(readAssistantText(sessionManager.getEntries?.() ?? [], { startIndex: sinceIndex, joiner: '\n' })?.includes(marker));
}

export function createNudgeState() {
  return {
    lastTodoReminderAt: new Map(),
    lastLoopReminderAt: new Map(),
    lastRunnerReminderAt: new Map(),
    lastNudgeEntryIndex: new Map(),
  };
}

function shouldThrottle(map, sessionId, now, ms = 5000) {
  const lastAt = map.get(sessionId) || 0;
  if (now - lastAt < ms) return true;
  map.set(sessionId, now);
  return false;
}

function recordNudgeSent(state, sessionId, entryCount) {
  state.lastNudgeEntryIndex.set(sessionId, entryCount);
}

export function handleTodoNudge(pi, state, sessionId, sessionManager) {
  const tasks = flattenTodoTasks(getLatestTodoPhasesFromEntries(sessionManager.getEntries?.() ?? []));
  if (!tasks.some((task) => !TERMINAL_TODO_STATUSES.has(task.status))) return;
  const entryCount = currentEntryCount(sessionManager);
  if (alreadySkippedSince(sessionManager, TODO_NUDGE_CHECK_TAG, state.lastNudgeEntryIndex.get(sessionId) ?? 0)) return;
  const now = Date.now();
  if (shouldThrottle(state.lastTodoReminderAt, sessionId, now)) return;
  pi.sendMessage({
    customType: 'kunwei-todo-reminder',
    content: TODO_NUDGE_PROMPT,
    display: false,
  }, { triggerTurn: true, deliverAs: 'nextTurn' });
  recordNudgeSent(state, sessionId, entryCount);
}

export function handleLoopNudge(pi, state, sessionId, sessionManager, isLoopActive) {
  if (!isLoopActive(sessionId)) return;
  const tasks = flattenTodoTasks(getLatestTodoPhasesFromEntries(sessionManager.getEntries?.() ?? []));
  if (tasks.some((task) => !TERMINAL_TODO_STATUSES.has(task.status))) return;
  const entryCount = currentEntryCount(sessionManager);
  if (alreadySkippedSince(sessionManager, '<skip-loop-check />', state.lastNudgeEntryIndex.get(sessionId) ?? 0)) return;
  const now = Date.now();
  if (shouldThrottle(state.lastLoopReminderAt, sessionId, now)) return;
  pi.sendMessage({
    customType: 'kunwei-loop-reminder',
    content: LOOP_NUDGE_PROMPT,
    display: false,
  }, { triggerTurn: true, deliverAs: 'nextTurn' });
  recordNudgeSent(state, sessionId, entryCount);
}

export function handleRunnerNudge(pi, state, sessionId, hasRunningJob) {
  if (!hasRunningJob(sessionId)) return;
  const now = Date.now();
  if (shouldThrottle(state.lastRunnerReminderAt, sessionId, now)) return;
  pi.sendMessage({
    customType: 'kunwei-runner-reminder',
    content: buildRunnerNudgePrompt(),
    display: false,
  }, { triggerTurn: true, deliverAs: 'nextTurn' });
}

export { TODO_NUDGE_PROMPT as TODO_NUDGE, LOOP_NUDGE_PROMPT as LOOP_NUDGE, buildRunnerNudgePrompt as RUNNER_NUDGE };

export const _test = {
  createNudgeState,
  flattenTodoTasks,
  shouldThrottle,
  isReviewActive,
  tryLockReview,
  unlockReview,
};
