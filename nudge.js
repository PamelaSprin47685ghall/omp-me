import { getLatestTodoPhasesFromEntries } from './todo-state.js';

const TODO_NUDGE = [
    'There are still incomplete todos. Continue working through the remaining items.',
    'If blocked, explain the blocker and ask for guidance.',
].join(' ');

const LOOP_NUDGE = [
    'Loop mode is still active.',
    'You must call submit_review with a detailed report and affected files before finishing.',
].join(' ');

const RUNNER_NUDGE = [
    'A runner task is still active in the background.',
    'Use runner_wait to collect more output or runner_abort to stop it before concluding.',
].join(' ');

export { LOOP_NUDGE, RUNNER_NUDGE, TODO_NUDGE };

const TERMINAL_TODO_STATUSES = new Set(['completed', 'abandoned']);

function flattenTodoTasks(phases) {
    return phases.flatMap((phase) => phase.tasks || []);
}

function hasOpenTodos(sessionManager) {
    const tasks = flattenTodoTasks(getLatestTodoPhasesFromEntries(sessionManager.getEntries?.() || []));
    return tasks.some((task) => !TERMINAL_TODO_STATUSES.has(task.status));
}

function collectAssistantText(entries, startIndex) {
    const chunks = [];
    for (let index = startIndex; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry?.type !== 'message') continue;
        if (entry.message?.role !== 'assistant') continue;
        for (const part of entry.message?.content || []) {
            if (part?.type === 'text' && part.text) chunks.push(part.text);
        }
    }
    return chunks.join('\n');
}

function alreadySkippedSince(sessionManager, marker, sinceIndex) {
    const entries = sessionManager.getEntries?.() || [];
    return collectAssistantText(entries, sinceIndex).includes(marker);
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

function currentEntryCount(sessionManager) {
    return sessionManager.getEntries?.()?.length ?? 0;
}

export function handleTodoNudge(pi, state, sessionId, sessionManager) {
    if (!hasOpenTodos(sessionManager)) return;
    const entryCount = currentEntryCount(sessionManager);
    if (alreadySkippedSince(sessionManager, '<skip-todo-check />', state.lastNudgeEntryIndex.get(sessionId) ?? 0)) return;
    const now = Date.now();
    if (shouldThrottle(state.lastTodoReminderAt, sessionId, now)) return;
    pi.sendMessage({
        customType: 'kunwei-todo-reminder',
        content: TODO_NUDGE,
        display: false,
    }, { triggerTurn: true, deliverAs: 'nextTurn' });
    recordNudgeSent(state, sessionId, entryCount);
}

export function handleLoopNudge(pi, state, sessionId, sessionManager, isLoopActive) {
    if (!isLoopActive(sessionId)) return;
    if (hasOpenTodos(sessionManager)) return;
    const entryCount = currentEntryCount(sessionManager);
    if (alreadySkippedSince(sessionManager, '<skip-loop-check />', state.lastNudgeEntryIndex.get(sessionId) ?? 0)) return;
    const now = Date.now();
    if (shouldThrottle(state.lastLoopReminderAt, sessionId, now)) return;
    pi.sendMessage({
        customType: 'kunwei-loop-reminder',
        content: LOOP_NUDGE,
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
        content: RUNNER_NUDGE,
        display: false,
    }, { triggerTurn: true, deliverAs: 'nextTurn' });
}

export const _test = {
    collectAssistantText,
    createNudgeState,
    flattenTodoTasks,
    hasOpenTodos,
    shouldThrottle,
};
