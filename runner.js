import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const runnerJobs = new Map();

const RUNNER_EARLY_TIMEOUT_MS = 5000;
const RUNNER_MAX_WAIT_MS = 30000;
const RUNNER_MIN_WAIT_MS = 100;
const RUNNER_LOG_DIR = path.join(tmpdir(), 'omp-kunwei-runner');
const HEAD_TAIL_PIPE_RE = /\s*\|\s*(head|tail)(?:\s+[^\s|&;()<>\n#`>]+)*/g;

const RUNNER_SYSTEM_PROMPT = [
    'You are a command output summarizer.',
    'The command has already been started by the system.',
    'You only have runner_wait and runner_abort.',
    'Summarize output concisely, mention errors explicitly, and do not invent details.',
].join(' ');

export const RUNNER_TOOL_NAMES = ['runner', 'runner_wait', 'runner_abort'];
export const RUNNER_LANGUAGES = ['shell', 'python', 'javascript'];

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

function ensureRunnerDir() {
    fs.mkdirSync(RUNNER_LOG_DIR, { recursive: true });
}

function getRunnerLogPath(sessionId) {
    ensureRunnerDir();
    return path.join(RUNNER_LOG_DIR, `runner-${sessionId}.log`);
}

function getRunnerProjectDir(sessionId) {
    ensureRunnerDir();
    return path.join(RUNNER_LOG_DIR, `runner-${sessionId}`);
}

function getRunnerTempScriptPath(sessionId, extension) {
    ensureRunnerDir();
    return path.join(RUNNER_LOG_DIR, `.runner-${sessionId}.${extension}`);
}

function openLogStream(logPath) {
    return fs.createWriteStream(logPath, { flags: 'a' });
}

function pipeToLog(logStream, source) {
    source.on('data', (chunk) => {
        if (logStream.destroyed || logStream.writableEnded) return;
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        if (!logStream.write(text) && source.pause) source.pause();
    });
    logStream.on('drain', () => {
        if (source.isPaused?.()) source.resume();
    });
}

function closeLogStream(logStream) {
    return new Promise((resolve) => {
        if (!logStream || logStream.destroyed) return resolve();
        logStream.end(() => resolve());
    });
}

function destroyLogStream(logStream) {
    if (!logStream || logStream.destroyed) return;
    try { logStream.destroy(); } catch {}
}

function ensureTrailingNewline(text) {
    if (!text) return '';
    return text.endsWith('\n') ? text : `${text}\n`;
}

function resolveJavascriptSpecifier(cwd, specifier) {
    const match = /^(\.{1,2}(?:\/[^?#]*)?)([?#].*)?$/.exec(specifier);
    if (!match) return specifier;
    return `${pathToFileURL(path.resolve(cwd, match[1])).href}${match[2] || ''}`;
}

function rewriteJavascriptModuleSpecifiers(program, cwd) {
    return program
        .replace(/\b(from\s*['"])(\.{1,2}\/[^'"]*)(['"])/g, (_match, prefix, specifier, suffix) => (
            `${prefix}${resolveJavascriptSpecifier(cwd, specifier)}${suffix}`
        ))
        .replace(/\b(export\s+\*\s+from\s*['"])(\.{1,2}\/[^'"]*)(['"])/g, (_match, prefix, specifier, suffix) => (
            `${prefix}${resolveJavascriptSpecifier(cwd, specifier)}${suffix}`
        ))
        .replace(/\b(import\s*\(\s*['"])(\.{1,2}\/[^'"]*)(['"]\s*\))/g, (_match, prefix, specifier, suffix) => (
            `${prefix}${resolveJavascriptSpecifier(cwd, specifier)}${suffix}`
        ));
}

function killProcessTree(childProcess) {
    const pid = childProcess?.pid;
    if (!pid) return;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
            return;
        }
        spawn('kill', ['-9', `-${pid}`], { stdio: 'ignore' });
    } catch {
        try {
            childProcess.kill('SIGKILL');
        } catch {}
    }
}

export function cleanupRunnerJob(sessionId) {
    const job = runnerJobs.get(sessionId);
    if (!job) return;

    if (job.status === 'running') {
        if (job.abortController) {
            try { job.abortController.abort(); } catch {}
        }
        if (job.childProcess) killProcessTree(job.childProcess);
        job.status = 'aborted';
    }

    destroyLogStream(job.logStream);

    try {
        if (fs.existsSync(job.logPath)) fs.unlinkSync(job.logPath);
    } catch {}

    try {
        if (job.tempPath && fs.existsSync(job.tempPath)) fs.unlinkSync(job.tempPath);
    } catch {}

    try {
        if (job.projectDir && fs.existsSync(job.projectDir)) fs.rmSync(job.projectDir, { recursive: true, force: true });
    } catch {}

    runnerJobs.delete(sessionId);
}

function createTempPythonScript(scriptPath, program) {
    fs.writeFileSync(scriptPath, program, 'utf-8');
    return scriptPath;
}

function createTempShellScript(scriptPath, program) {
    fs.writeFileSync(scriptPath, program, 'utf-8');
    if (process.platform !== 'win32') fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
}

function createTempJavascriptScript(scriptPath, program) {
    fs.writeFileSync(scriptPath, `${program}\n`, 'utf-8');
    return scriptPath;
}

function createJavascriptPrelude(cwd, scriptPath) {
    return [
        'import { createRequire } from "node:module";',
        `const require = createRequire(${JSON.stringify(path.join(cwd, '__runner__.cjs'))});`,
        `const __dirname = ${JSON.stringify(path.dirname(scriptPath))};`,
        `const __filename = ${JSON.stringify(scriptPath)};`,
        '',
    ].join('\n');
}

async function ensureJavascriptProject(projectDir, dependencies) {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{"type":"module"}\n', 'utf-8');

    const requiredPackages = [...new Set(['tsx', ...(dependencies || [])])];
    if (requiredPackages.length === 0) return;

    await runChildProcess({
        command: 'npx',
        args: ['--yes', 'npm@latest', 'install', '--prefix', projectDir, ...requiredPackages],
        cwd: projectDir,
    });
}

function runChildProcess({ command, args, cwd, env, signal }) {
    return new Promise((resolve, reject) => {
        const childProcess = spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        childProcess.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        const onAbort = () => killProcessTree(childProcess);
        signal?.addEventListener('abort', onAbort, { once: true });

        childProcess.on('error', (error) => {
            signal?.removeEventListener('abort', onAbort);
            reject(error);
        });

        childProcess.on('close', (code) => {
            signal?.removeEventListener('abort', onAbort);
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error((`${stdout}${stderr}`).trim() || `${command} exited with code ${code}`));
        });
    });
}

function readCurrentOutput(logPath) {
    return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').trim() || '(no output)' : '(no output)';
}

async function executeShellProgram(options, job) {
    const extension = process.platform === 'win32' ? 'ps1' : 'sh';
    const scriptPath = createTempShellScript(getRunnerTempScriptPath(job.sessionId, extension), options.program);
    job.tempPath = scriptPath;

    const childProcess = spawn(
        process.platform === 'win32' ? 'powershell.exe' : 'bash',
        process.platform === 'win32'
            ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]
            : [scriptPath],
        {
            cwd: options.cwd,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            windowsHide: true,
        }
    );

    job.childProcess = childProcess;
    pipeToLog(job.logStream, childProcess.stdout);
    pipeToLog(job.logStream, childProcess.stderr);

    return await new Promise((resolve, reject) => {
        childProcess.on('error', reject);
        childProcess.on('close', async (code) => {
            await closeLogStream(job.logStream);
            job.logStream = null;
            resolve({
                output: readCurrentOutput(job.logPath),
                cancelled: job.abortController.signal.aborted,
                exitCode: code === null ? undefined : code,
            });
        });
    });
}

async function executePythonProgram(options, job) {
    const scriptPath = createTempPythonScript(getRunnerTempScriptPath(job.sessionId, 'py'), options.program);
    job.tempPath = scriptPath;

    const args = ['--isolated'];
    for (const dependency of options.dependencies || []) {
        args.push('--with', dependency);
    }
    args.push('--from', 'python', 'python', scriptPath);

    const childProcess = spawn('uvx', args, {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
    });

    job.childProcess = childProcess;
    pipeToLog(job.logStream, childProcess.stdout);
    pipeToLog(job.logStream, childProcess.stderr);

    return await new Promise((resolve, reject) => {
        childProcess.on('error', reject);
        childProcess.on('close', async (code) => {
            await closeLogStream(job.logStream);
            job.logStream = null;
            resolve({
                output: readCurrentOutput(job.logPath),
                cancelled: job.abortController.signal.aborted,
                exitCode: code === null ? undefined : code,
            });
        });
    });
}

async function executeJavascriptProgram(options, job) {
    const projectDir = job.projectDir;
    await ensureJavascriptProject(projectDir, options.dependencies);
    const scriptPath = getRunnerTempScriptPath(job.sessionId, 'mts');
    const scriptBody = `${createJavascriptPrelude(options.cwd, scriptPath)}${rewriteJavascriptModuleSpecifiers(options.program, options.cwd)}`;
    createTempJavascriptScript(scriptPath, scriptBody);
    job.tempPath = scriptPath;

    const childProcess = spawn('npx', ['--prefix', projectDir, '--yes', '--no-install', 'tsx', scriptPath], {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
    });

    job.childProcess = childProcess;
    pipeToLog(job.logStream, childProcess.stdout);
    pipeToLog(job.logStream, childProcess.stderr);

    return await new Promise((resolve, reject) => {
        childProcess.on('error', reject);
        childProcess.on('close', async (code) => {
            await closeLogStream(job.logStream);
            job.logStream = null;
            resolve({
                output: readCurrentOutput(job.logPath),
                cancelled: job.abortController.signal.aborted,
                exitCode: code === null ? undefined : code,
            });
        });
    });
}

async function executeRunnerJob(sessionId, options) {
    const existing = runnerJobs.get(sessionId);
    if (existing?.status === 'running') {
        throw new Error('A task is already running. Use runner_wait or runner_abort first.');
    }
    if (existing) cleanupRunnerJob(sessionId);

    const language = options.language === 'python' || options.language === 'javascript' ? options.language : 'shell';
    const program = language === 'shell' ? stripHeadTailPipes(options.program).script : options.program;
    const logPath = getRunnerLogPath(sessionId);
    fs.writeFileSync(logPath, '');

    const job = {
        sessionId,
        logPath,
        projectDir: language === 'javascript' || language === 'python'
            ? getRunnerProjectDir(sessionId)
            : null,
        tempPath: null,
        logStream: openLogStream(logPath),
        childProcess: null,
        abortController: new AbortController(),
        bytesRead: 0,
        status: 'running',
        closePromise: null,
    };

    runnerJobs.set(sessionId, job);

    job.closePromise = (async () => {
        try {
            const result = language === 'shell'
                ? await executeShellProgram({ ...options, program }, job)
                : language === 'python'
                    ? await executePythonProgram({ ...options, program }, job)
                    : await executeJavascriptProgram({ ...options, program }, job);

            if (job.status === 'running') {
                job.status = result.cancelled ? 'aborted' : 'completed';
            }

            if (result.cancelled) job.status = 'aborted';

            if (result.exitCode !== undefined && result.exitCode !== 0) {
                await fs.promises.appendFile(logPath, ensureTrailingNewline(`Command exited with code ${result.exitCode}`), 'utf-8');
            }
        } catch (error) {
            if (job.status === 'running') job.status = 'aborted';
            if (!fs.existsSync(logPath) || fs.readFileSync(logPath, 'utf-8') === '') {
                await fs.promises.writeFile(logPath, ensureTrailingNewline(error instanceof Error ? error.message : String(error)), 'utf-8');
            }
            throw error;
        }
    })();

    try {
        const completedEarly = await Promise.race([
            job.closePromise.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), RUNNER_EARLY_TIMEOUT_MS)),
        ]);

        if (completedEarly) {
            const output = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
            cleanupRunnerJob(sessionId);
            return { output: output.trim() || '(no output)', background: false, message: '[System] Task completed.' };
        }

        const output = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
        job.bytesRead = output.length;
        return {
            output: output.trim() || '(no output yet)',
            background: true,
            message: '[System] Task has been backgrounded. Use runner_wait or runner_abort.',
        };
    } catch (error) {
        cleanupRunnerJob(sessionId);
        throw error;
    }
}

async function waitRunnerJob(sessionId, ms) {
    const job = runnerJobs.get(sessionId);
    if (!job) throw new Error('No active job found.');
    if (job.status !== 'running') {
        const output = fs.existsSync(job.logPath) ? fs.readFileSync(job.logPath, 'utf-8') : '';
        const nextOutput = output.slice(job.bytesRead).trim();
        cleanupRunnerJob(sessionId);
        return {
            output: nextOutput || '(no new output)',
            completed: true,
            message: job.status === 'completed' ? '[System] Task has completed.' : '[System] Task was aborted.',
        };
    }

    await Promise.race([job.closePromise.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
    const output = fs.existsSync(job.logPath) ? fs.readFileSync(job.logPath, 'utf-8') : '';
    const nextOutput = output.slice(job.bytesRead).trim();
    job.bytesRead = output.length;

    if (job.status !== 'running') {
        cleanupRunnerJob(sessionId);
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

function abortRunnerJob(sessionId) {
    const job = runnerJobs.get(sessionId);
    if (!job) return '[System] No active task found.';
    job.status = 'aborted';
    cleanupRunnerJob(sessionId);
    return '[System] Task has been forcefully terminated.';
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

export function resetRunnerJobs() {
    for (const sessionId of [...runnerJobs.keys()]) cleanupRunnerJob(sessionId);
}

export function hasRunningRunnerJob(sessionId) {
    return runnerJobs.get(sessionId)?.status === 'running';
}

export function setRunnerJobStateForTest(sessionId, status = 'running') {
    const logPath = path.join(RUNNER_LOG_DIR, `test-${sessionId}.log`);
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

export function registerRunnerTools(pi, helpers) {
    const { asErrorResult, createChildSession, getSessionIdFromContext, readAssistantText } = helpers;

    pi.on('session_shutdown', (_event, ctx) => {
        const sessionId = getSessionIdFromContext(ctx);
        if (sessionId) cleanupRunnerJob(sessionId);
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
            return { content: [{ type: 'text', text: sessionId ? abortRunnerJob(sessionId) : 'No runner session found.' }] };
        },
    });
}
