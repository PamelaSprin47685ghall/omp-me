import fs from 'node:fs';
import {
  RUNNER_EARLY_TIMEOUT_MS,
  RUNNER_MAX_WAIT_MS,
  RUNNER_MIN_WAIT_MS,
  RUNNER_LANGUAGES,
  RUNNER_SYSTEM_PROMPT,
  abort,
  buildRunnerPrompt,
  cleanupJob,
  execute,
  getActiveJobs,
  getRunnerLogPath,
  hasActiveJob,
  stripHeadTailPipes,
  wait,
} from 'engine/runner';

export { stripHeadTailPipes };

export const RUNNER_TOOL_NAMES = ['runner', 'runner_wait', 'runner_abort'];

const runnerJobs = new Map();

export async function cleanupRunnerJob(sessionId) {
  await cleanupJob(sessionId);
  runnerJobs.delete(sessionId);
}

export function resetRunnerJobs() {
  for (const sessionId of [...runnerJobs.keys()]) cleanupRunnerJob(sessionId).catch(() => {});
  runnerJobs.clear();
}

export function hasRunningRunnerJob(sessionId) {
  return hasActiveJob(getActiveJobs, sessionId) || runnerJobs.has(sessionId);
}

export function setRunnerJobStateForTest(sessionId, status = 'running') {
  const logPath = getRunnerLogPath(`test-${sessionId}`);
  fs.writeFileSync(logPath, '');
  runnerJobs.set(sessionId, { status });
}

export async function waitRunnerJob(sessionId, ms) {
  return await wait({ sessionId, ms });
}

export function registerRunnerTools(pi, helpers) {
  const { asErrorResult, createChildSession, getSessionIdFromContext, readAssistantText } = helpers;

  pi.on('session_shutdown', (_event, ctx) => {
    const sessionId = getSessionIdFromContext(ctx);
    if (sessionId) cleanupRunnerJob(sessionId).catch(() => {});
  });

  pi.registerTool({
    name: 'runner',
    label: 'Runner',
    description: 'Execute shell, Python, or JavaScript and return a summary, with background wait/abort support.',
    parameters: pi.typebox.Object({
      language: pi.typebox.Optional(pi.typebox.Enum(RUNNER_LANGUAGES, { description: 'shell, python, or javascript' })),
      program: pi.typebox.String({ description: 'Shell command, Python code, or JavaScript/TypeScript code.' }),
      dependencies: pi.typebox.Optional(pi.typebox.Array(pi.typebox.String({ description: 'Language dependencies.' }))),
      what_to_summarize: pi.typebox.String({ description: 'What to summarize from output.' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const language = RUNNER_LANGUAGES.includes(params.language) ? params.language : 'shell';
      try {
        const child = await createChildSession(pi, ctx, {
          toolNames: ['runner_wait', 'runner_abort'],
          systemPrompt: [RUNNER_SYSTEM_PROMPT, ...(ctx?.getSystemPrompt?.() || [])],
        });
        try {
          const childSessionId = child.session.sessionManager.getSessionId();
          const runResult = await execute({
            sessionId: childSessionId,
            program: params.program,
            language,
            dependencies: params.dependencies,
            cwd: ctx.cwd,
            timeoutMs: RUNNER_MAX_WAIT_MS * 120,
          });
          await child.session.prompt(buildRunnerPrompt(language, params.program, params.dependencies, params.what_to_summarize, runResult.output, runResult.background, runResult.message));
          await child.session.waitForIdle();
          return { content: [{ type: 'text', text: readAssistantText(child.session.sessionManager) ?? '(no output)' }] };
        } finally {
          child.session.abort?.();
          child.dispose?.();
        }
      } catch (error) {
        return asErrorResult(error);
      }
    },
  });

  pi.registerTool({
    name: 'runner_wait',
    label: 'Runner Wait',
    description: 'Wait for background runner output.',
    defaultInactive: true,
    parameters: pi.typebox.Object({
      ms: pi.typebox.Optional(pi.typebox.Number({ description: 'Wait time in milliseconds.' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = getSessionIdFromContext(ctx);
      if (!sessionId) return { content: [{ type: 'text', text: 'No runner session found.' }], isError: true };
      try {
        const waitMs = Math.max(RUNNER_MIN_WAIT_MS, Math.min(RUNNER_MAX_WAIT_MS, params.ms ?? 2000));
        const result = await wait({ sessionId, ms: waitMs });
        return { content: [{ type: 'text', text: [result.output, result.message].filter(Boolean).join('\n\n') || '(no new output)' }] };
      } catch (error) {
        return asErrorResult(error);
      }
    },
  });

  pi.registerTool({
    name: 'runner_abort',
    label: 'Runner Abort',
    description: 'Abort background runner task.',
    defaultInactive: true,
    parameters: pi.typebox.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionId = getSessionIdFromContext(ctx);
      if (!sessionId) return { content: [{ type: 'text', text: 'No runner session found.' }], isError: true };
      try {
        return { content: [{ type: 'text', text: abort(sessionId) }] };
      } catch (error) {
        return asErrorResult(error);
      }
    },
  });
}
