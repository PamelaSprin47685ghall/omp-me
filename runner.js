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
const HEAD_TAIL_PIPE_RE = /\s*\|\s*(head|tail)\s+(?:-n\s*|-)\d+(?=\s*(?:[;&\n#]|$))/g;

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
    if (!result.background) {
        return [
            `The following ${language} program has been executed.`,
            '',
            'Task completed.',
            '',
            'Program:',
            program,
            '',
            dependencyList.trimEnd(),
            dependencyList ? '' : null,
            'What to summarize:',
            whatToSummarize,
            '',
            'Execution output:',
            result.output,
            result.message || null,
        ].filter(Boolean).join('\n');
    }
    return [
        `The following ${language} program is running in background.`,
        '',
        'Use runner_wait to poll for more output or runner_abort to stop the task.',
        '',
        'Program:',
        program,
        '',
        dependencyList.trimEnd(),
        dependencyList ? '' : null,
        'What to summarize:',
        whatToSummarize,
        '',
        'Initial output:',
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

function getRunnerTempScriptPath(cwd, sessionId, extension) {
    return path.join(cwd, `.runner-${sessionId}.${extension}`);
}

function appendLogChunk(logPath, text) {
    if (!text) return;
    fs.appendFileSync(logPath, text, 'utf-8');
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
            try {
                job.abortController.abort();
            } catch {}
        }
        if (job.childProcess) {
            killProcessTree(job.childProcess);
        }
        job.status = 'aborted';
    }

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

function createJavascriptPrelude(cwd) {
    return [
        'import { createRequire } from "node:module";',
        `const require = createRequire(${JSON.stringify(path.join(cwd, '__runner__.cjs'))});`,
        `const __dirname = ${JSON.stringify(cwd)};`,
        `const __filename = ${JSON.stringify(path.join(cwd, '__runner__.mjs'))};`,
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

        childProcess.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        childProcess.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        const onAbort = () => {
            killProcessTree(childProcess);
        };
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

async function executeShellProgram(options, job, appendChunk) {
    const extension = process.platform === 'win32' ? 'ps1' : 'sh';
    const scriptPath = createTempShellScript(getRunnerTempScriptPath(options.cwd, job.sessionId, extension), options.program);
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
    childProcess.stdout?.on('data', (chunk) => appendChunk(chunk.toString()));
    childProcess.stderr?.on('data', (chunk) => appendChunk(chunk.toString()));

    return await new Promise((resolve, reject) => {
        childProcess.on('error', reject);
        childProcess.on('close', (code) => {
            resolve({
                output: readCurrentOutput(job.logPath),
                cancelled: job.abortController.signal.aborted,
                exitCode: code === null ? undefined : code,
            });
        });
    });
}

async function executePythonProgram(options, job, appendChunk) {
    const scriptPath = createTempPythonScript(getRunnerTempScriptPath(options.cwd, job.sessionId, 'py'), options.program);
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
    childProcess.stdout?.on('data', (chunk) => appendChunk(chunk.toString()));
    childProcess.stderr?.on('data', (chunk) => appendChunk(chunk.toString()));

    return await new Promise((resolve, reject) => {
        childProcess.on('error', reject);
        childProcess.on('close', (code) => {
            resolve({
                output: readCurrentOutput(job.logPath),
                cancelled: job.abortController.signal.aborted,
                exitCode: code === null ? undefined : code,
            });
        });
    });
}

async function executeJavascriptProgram(options, job, appendChunk) {
    const projectDir = job.projectDir;
    await ensureJavascriptProject(projectDir, options.dependencies);
    const scriptBody = `${createJavascriptPrelude(options.cwd)}${rewriteJavascriptModuleSpecifiers(options.program, options.cwd)}`;
    const scriptPath = createTempJavascriptScript(getRunnerTempScriptPath(projectDir, job.sessionId, 'mts'), scriptBody);
    job.tempPath = scriptPath;

    const childProcess = spawn('npx', ['--prefix', projectDir, '--yes', '--no-install', 'tsx', scriptPath], {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
    });

    job.childProcess = childProcess;
    childProcess.stdout?.on('data', (chunk) => appendChunk(chunk.toString()));
    childProcess.stderr?.on('data', (chunk) => appendChunk(chunk.toString()));

    return await new Promise((resolve, reject) => {
        childProcess.on('error', reject);
        childProcess.on('close', (code) => {
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

    const job = {
        sessionId,
        logPath,
        projectDir: language === 'javascript' || language === 'python'
            ? getRunnerProjectDir(sessionId)
            : null,
        tempPath: null,
        childProcess: null,
        abortController: new AbortController(),
        bytesRead: 0,
        status: 'running',
        closePromise: null,
    };

    runnerJobs.set(sessionId, job);

    const appendChunk = (text) => appendLogChunk(logPath, text);

    job.closePromise = (async () => {
        try {
            const result = language === 'shell'
                ? await executeShellProgram({ ...options, program }, job, appendChunk)
                : language === 'python'
                    ? await executePythonProgram({ ...options, program }, job, appendChunk)
                    : await executeJavascriptProgram({ ...options, program }, job, appendChunk);

            if (job.status === 'running') {
                job.status = result.cancelled ? 'aborted' : 'completed';
            }

            if ((result.output?.trim() || '') !== (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').trim() : '')) {
                fs.writeFileSync(logPath, ensureTrailingNewline(result.output || '(no output)'), 'utf-8');
            }

            if (result.cancelled) {
                job.status = 'aborted';
            }

            if (result.exitCode !== undefined && result.exitCode !== 0) {
                appendLogChunk(logPath, ensureTrailingNewline(`Command exited with code ${result.exitCode}`));
            }
        } catch (error) {
            if (job.status === 'running') job.status = 'aborted';
            if (!fs.existsSync(logPath)) {
                fs.writeFileSync(logPath, ensureTrailingNewline(error instanceof Error ? error.message : String(error)), 'utf-8');
            }
            throw error;
        }
    })();
    void job.closePromise.catch(() => {});

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
    runnerJobs.set(sessionId, {
        status,
        abortController: new AbortController(),
        childProcess: null,
        logPath: path.join(RUNNER_LOG_DIR, `test-${sessionId}.log`),
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
                    return { content: [{ type: 'text', text: readAssistantText(child.session.sessionManager) }] };
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
