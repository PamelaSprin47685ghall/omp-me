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

const TERMINAL_TODO_STATUSES = new Set(['completed', 'abandoned']);

function flattenTodoTasks(phases) {
    return phases.flatMap((phase) => phase.tasks || []);
}

function hasOpenTodos(sessionManager) {
    const tasks = flattenTodoTasks(getLatestTodoPhasesFromEntries(sessionManager.getEntries?.() || []));
    return tasks.some((task) => !TERMINAL_TODO_STATUSES.has(task.status));
}

function lastAssistantText(sessionManager) {
    const entries = sessionManager.getEntries?.() || [];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.type !== 'message') continue;
        if (entry.message?.role !== 'assistant') continue;
        const parts = entry.message?.content || [];
        const texts = parts.filter((part) => part?.type === 'text' && part.text).map((part) => part.text);
        if (texts.length > 0) return texts.join('\n');
    }
    return '';
}

function alreadySkipped(sessionManager, marker) {
    return lastAssistantText(sessionManager).includes(marker);
}

export function createNudgeState() {
    return {
        lastTodoReminderAt: new Map(),
        lastLoopReminderAt: new Map(),
        lastRunnerReminderAt: new Map(),
    };
}

function shouldThrottle(map, sessionId, now, ms = 5000) {
    const lastAt = map.get(sessionId) || 0;
    if (now - lastAt < ms) return true;
    map.set(sessionId, now);
    return false;
}

export function handleTodoNudge(pi, state, sessionId, sessionManager) {
    if (!hasOpenTodos(sessionManager)) return;
    if (alreadySkipped(sessionManager, '<skip-todo-check />')) return;
    const now = Date.now();
    if (shouldThrottle(state.lastTodoReminderAt, sessionId, now)) return;
    pi.sendMessage({
        customType: 'kunwei-todo-reminder',
        content: TODO_NUDGE,
        display: false,
    }, { triggerTurn: true, deliverAs: 'nextTurn' });
}

export function handleLoopNudge(pi, state, sessionId, sessionManager, isLoopActive) {
    if (!isLoopActive(sessionId)) return;
    if (hasOpenTodos(sessionManager)) return;
    if (alreadySkipped(sessionManager, '<skip-loop-check />')) return;
    const now = Date.now();
    if (shouldThrottle(state.lastLoopReminderAt, sessionId, now)) return;
    pi.sendMessage({
        customType: 'kunwei-loop-reminder',
        content: LOOP_NUDGE,
        display: false,
    }, { triggerTurn: true, deliverAs: 'nextTurn' });
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
    alreadySkipped,
    createNudgeState,
    flattenTodoTasks,
    hasOpenTodos,
    lastAssistantText,
    shouldThrottle,
};
