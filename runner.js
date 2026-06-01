import fs from 'node:fs';
import path from 'node:path';
import { ensureTrailingNewline, getRunnerLogPath, getRunnerProjectDir, openLogStream, closeLogStream, destroyLogStream, RUNNER_EARLY_TIMEOUT_MS, RUNNER_MAX_WAIT_MS, RUNNER_MIN_WAIT_MS, RUNNER_LANGUAGES, HEAD_TAIL_PIPE_RE } from './runner-paths.js';
import { killProcessTree } from './runner-process.js';
import { executeShellProgram, executePythonProgram, executeJavascriptProgram } from './runner-exec.js';

const runnerJobs = new Map();

const RUNNER_SYSTEM_PROMPT = [
    'You are a command output summarizer.',
    'The command has already been started by the system.',
    'You only have runner_wait and runner_abort.',
    'Summarize output concisely, mention errors explicitly, and do not invent details.',
].join(' ');

export const RUNNER_TOOL_NAMES = ['runner', 'runner_wait', 'runner_abort'];

function buildRunnerPrompt(language, program, dependencies, whatToSummarize, result) {
    const dependencyList = dependencies?.length ? `Dependencies: ${dependencies.join(', ')}\n\n` : '';
    const headline = result.background
        ? `The following ${language} program is running in background.`
        : `The following ${language} program has been executed.`;
    const nextStep = result.background
        ? 'Use runner_wait to poll for more output or runner_abort to stop the task.'
        : 'Task completed.';
    return [
        headline,
        '',
        nextStep,
        '',
        'Program:',
        program,
        '',
        dependencyList.trimEnd(),
        dependencyList ? '' : null,
        'What to summarize:',
        whatToSummarize,
        '',
        result.background ? 'Initial output:' : 'Execution output:',
        result.output,
        result.message || null,
    ].filter(Boolean).join('\n');
}

export function stripHeadTailPipes(script) {
    let current = script;
    while (true) {
        let changed = false;
        const next = current.replace(HEAD_TAIL_PIPE_RE, () => {
            changed = true;
            return '';
        });
        if (!changed) return { script: current };
        current = next;
    }
}

export async function cleanupRunnerJob(sessionId) {
    const job = runnerJobs.get(sessionId);
    if (!job) return;

    if (job.status === 'running') {
        try { job.abortController?.abort(); } catch {}
        if (job.childProcess) killProcessTree(job.childProcess);
        job.status = 'aborted';
    }

    if (job.logStream) {
        await closeLogStream(job.logStream);
        job.logStream = null;
    }

    try { if (fs.existsSync(job.logPath)) fs.unlinkSync(job.logPath); } catch {}
    try { if (job.tempPath && fs.existsSync(job.tempPath)) fs.unlinkSync(job.tempPath); } catch {}
    try { if (job.projectDir && fs.existsSync(job.projectDir)) fs.rmSync(job.projectDir, { recursive: true, force: true }); } catch {}

    runnerJobs.delete(sessionId);
}

export function resetRunnerJobs() {
    for (const sessionId of [...runnerJobs.keys()]) cleanupRunnerJob(sessionId).catch(() => {});
}

export function hasRunningRunnerJob(sessionId) {
    return runnerJobs.get(sessionId)?.status === 'running';
}

export function setRunnerJobStateForTest(sessionId, status = 'running') {
    const logPath = getRunnerLogPath(`test-${sessionId}`);
    fs.writeFileSync(logPath, '');
    runnerJobs.set(sessionId, {
        status,
        abortController: new AbortController(),
        childProcess: null,
        logPath,
        logStream: null,
        tempPath: null,
        projectDir: null,
        bytesRead: 0,
        closePromise: Promise.resolve(),
        sessionId,
    });
}

async function executeRunnerJob(sessionId, options) {
    const existing = runnerJobs.get(sessionId);
    if (existing?.status === 'running') {
        throw new Error('A task is already running. Use runner_wait or runner_abort first.');
    }
    if (existing) await cleanupRunnerJob(sessionId);

    const language = options.language === 'python' || options.language === 'javascript' ? options.language : 'shell';
    const program = language === 'shell' ? stripHeadTailPipes(options.program).script : options.program;
    const logPath = getRunnerLogPath(sessionId);
    fs.writeFileSync(logPath, '');

    const job = {
        sessionId,
        logPath,
        projectDir: language === 'javascript' ? getRunnerProjectDir(sessionId) : null,
        tempPath: null,
        logStream: openLogStream(logPath),
        childProcess: null,
        abortController: new AbortController(),
        bytesRead: 0,
        status: 'running',
    };

    runnerJobs.set(sessionId, job);

    const runWithTimeout = (() => {
        const execute = language === 'shell'
            ? executeShellProgram
            : language === 'python'
                ? executePythonProgram
                : executeJavascriptProgram;
        return execute({ ...options, program, timeoutMs: options.timeoutMs }, job);
    })();

    runWithTimeout.then(
        async (result) => {
            if (job.status === 'running') {
                job.status = result.cancelled ? 'aborted' : 'completed';
            } else if (result.cancelled) {
                job.status = 'aborted';
            }
            if (result.exitCode !== undefined && result.exitCode !== 0) {
                await fs.promises.appendFile(logPath, ensureTrailingNewline(`Command exited with code ${result.exitCode}`), 'utf-8');
            }
        },
        async (error) => {
            if (job.status === 'running') job.status = 'aborted';
            const message = error instanceof Error ? error.message : String(error);
            if (!fs.existsSync(logPath) || fs.readFileSync(logPath, 'utf-8') === '') {
                await fs.promises.writeFile(logPath, ensureTrailingNewline(message), 'utf-8');
            }
        },
    );

    const completedEarly = await Promise.race([
        runWithTimeout.then(() => true, () => true),
        new Promise((resolve) => setTimeout(() => resolve(false), RUNNER_EARLY_TIMEOUT_MS)),
    ]);

    if (completedEarly) {
        const output = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
        await cleanupRunnerJob(sessionId);
        return { output: output.trim() || '(no output)', background: false, message: '[System] Task completed.' };
    }

    const output = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
    job.bytesRead = output.length;
    return {
        output: output.trim() || '(no output yet)',
        background: true,
        message: '[System] Task has been backgrounded. Use runner_wait or runner_abort.',
    };
}

async function waitRunnerJob(sessionId, ms) {
    const job = runnerJobs.get(sessionId);
    if (!job) throw new Error('No active job found.');
    if (job.status !== 'running') {
        const output = fs.existsSync(job.logPath) ? fs.readFileSync(job.logPath, 'utf-8') : '';
        const nextOutput = output.slice(job.bytesRead).trim();
        await cleanupRunnerJob(sessionId);
        return {
            output: nextOutput || '(no new output)',
            completed: true,
            message: job.status === 'completed' ? '[System] Task has completed.' : '[System] Task was aborted.',
        };
    }

    await new Promise((resolve) => setTimeout(resolve, ms));
    const output = fs.existsSync(job.logPath) ? fs.readFileSync(job.logPath, 'utf-8') : '';
    const nextOutput = output.slice(job.bytesRead).trim();
    job.bytesRead = output.length;

    if (job.status !== 'running') {
        await cleanupRunnerJob(sessionId);
        return {
            output: nextOutput || '(no new output)',
            completed: true,
            message: job.status === 'completed' ? '[System] Task has completed.' : '[System] Task was aborted.',
        };
    }

    return {
        output: nextOutput || '(no new output)',
        completed: false,
        message: nextOutput ? '[System] Task still running in background.' : '[System] Task still running. No new output.',
    };
}

async function abortRunnerJob(sessionId) {
    const job = runnerJobs.get(sessionId);
    if (!job) return { message: 'No active task found.', aborted: false };
    job.status = 'aborted';
    await cleanupRunnerJob(sessionId);
    return { message: 'Task has been forcefully terminated.', aborted: true };
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
                    const runResult = await executeRunnerJob(childSessionId, {
                        language,
                        program: params.program,
                        dependencies: params.dependencies,
                        cwd: ctx.cwd,
                        timeoutMs: RUNNER_MAX_WAIT_MS * 120,
                    });
                    await child.session.prompt(buildRunnerPrompt(language, params.program, params.dependencies, params.what_to_summarize, runResult));
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
                const result = await waitRunnerJob(sessionId, waitMs);
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
                const result = await abortRunnerJob(sessionId);
                return { content: [{ type: 'text', text: result.message }] };
            } catch (error) {
                return asErrorResult(error);
            }
        },
    });
}
