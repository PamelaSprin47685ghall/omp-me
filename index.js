import { createChildSession, readAssistantText, runSubagent } from './agent-session.js';
import { appendCapsContext, buildCapsContext, stripHostAgentsPrompt } from './caps.js';
import { _test as fuzzyTest, createFuzzyFindTool, createFuzzyGrepTool, resetFuzzyState } from './fuzzy.js';
import { LOOP_TOOL_NAMES, registerLoopFeatures, resetReviewStates, setPendingReviewStateForTest } from './loop.js';
import { isReviewActive } from './loop.js';
import { TODO_NUDGE, handleLoopNudge, handleRunnerNudge, handleTodoNudge, createNudgeState } from './nudge.js';
import { getOllamaKey, OLLAMA_TOOL_NAMES, registerOllamaTools } from './ollama.js';
import { patchDisablePrune } from './prune.js';
import { RUNNER_TOOL_NAMES, registerRunnerTools, resetRunnerJobs, stripHeadTailPipes, hasRunningRunnerJob, setRunnerJobStateForTest } from './runner.js';
import { asErrorResult, getSessionIdFromContext, stringArraySchema } from './shared.js';
import { registerSubagentTools, SUBAGENT_TOOL_NAMES } from './subagents.js';
import { appendSyntaxDiagnostics } from './tree-sitter.js';

const registered = new WeakSet();

patchDisablePrune().catch(() => {});

export default async function kunweiExtension(pi) {
    if (registered.has(pi)) return;
    registered.add(pi);

    const sharedHelpers = {
        asErrorResult,
        createChildSession,
        getSessionIdFromContext,
        readAssistantText,
        runSubagent,
        stringArraySchema,
    };
    const nudgeState = createNudgeState();

    pi.on('before_agent_start', (event, ctx) => ({
        systemPrompt: appendCapsContext(stripHostAgentsPrompt(event.systemPrompt), ctx.cwd),
    }));

    pi.on('tool_result', async (event, ctx) => {
        return await appendSyntaxDiagnostics(ctx.cwd, event);
    });

    pi.on('todo_reminder', (event, ctx) => {
        if (!event.todos?.length) return;
        pi.sendMessage({
            customType: 'kunwei-todo-reminder',
            content: TODO_NUDGE,
            display: false,
        }, { triggerTurn: true, deliverAs: 'nextTurn' });
        const sessionId = getSessionIdFromContext(ctx);
        if (sessionId) nudgeState.lastTodoReminderAt.set(sessionId, Date.now());
    });

    pi.on('agent_end', (_event, ctx) => {
        const sessionId = getSessionIdFromContext(ctx);
        if (!sessionId) return;
        if (hasRunningRunnerJob(sessionId)) {
            handleRunnerNudge(pi, nudgeState, sessionId, hasRunningRunnerJob);
            return;
        }
        if (isReviewActive(sessionId) && !ctx.hasPendingMessages?.()) {
            handleLoopNudge(pi, nudgeState, sessionId, ctx.sessionManager, isReviewActive);
            return;
        }
        handleTodoNudge(pi, nudgeState, sessionId, ctx.sessionManager);
    });

    pi.on('session_shutdown', (_event, ctx) => {
        const sessionId = getSessionIdFromContext(ctx);
        if (!sessionId) return;
        nudgeState.lastTodoReminderAt.delete(sessionId);
        nudgeState.lastLoopReminderAt.delete(sessionId);
        nudgeState.lastRunnerReminderAt.delete(sessionId);
        nudgeState.lastNudgeEntryIndex.delete(sessionId);
    });

    pi.on('session_start', async () => {
        const keep = new Set(['read', 'find', 'fuzzy_find', 'fuzzy_grep', 'edit', 'write', 'lsp', ...SUBAGENT_TOOL_NAMES, ...RUNNER_TOOL_NAMES, ...LOOP_TOOL_NAMES, ...OLLAMA_TOOL_NAMES]);
        const desired = new Set(pi.getActiveTools().filter((toolName) => keep.has(toolName)));
        desired.add('fuzzy_grep');
        desired.add('fuzzy_find');
        desired.add('find');
        await pi.setActiveTools([...desired]);
    });

    registerLoopFeatures(pi, sharedHelpers);

    registerSubagentTools(pi, sharedHelpers);
    registerOllamaTools(pi, sharedHelpers);

    pi.registerTool(createFuzzyFindTool(pi));
    pi.registerTool(createFuzzyGrepTool(pi));

    registerRunnerTools(pi, sharedHelpers);
}

export const _test = {
    appendCapsContext,
    buildCapsContext,
    stripHostAgentsPrompt,
    stripHeadTailPipes,
    appendSyntaxDiagnostics,
    checkSyntax: async (...args) => (await import('./tree-sitter.js')).checkSyntax(...args),
    supportsSyntaxDiagnosticsTool: async (toolName) => (await import('./tree-sitter.js')).supportsSyntaxDiagnosticsTool(toolName),
    fuzzy: fuzzyTest,
    getOllamaKey,
    setPendingReviewStateForTest,
    setRunnerJobStateForTest,
    reset() {
        resetReviewStates();
        resetRunnerJobs();
        resetFuzzyState();
    },
};
