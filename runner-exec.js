import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { closeLogStream, getRunnerTempScriptPath, pipeToLog, readCurrentOutput } from './runner-paths.js';
import { ensureJavascriptProject } from './runner-javascript.js';

function createTempShellScript(scriptPath, program) {
    fs.writeFileSync(scriptPath, program, 'utf-8');
    if (process.platform !== 'win32') fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
}

export async function executeShellProgram(options, job) {
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

export async function executePythonProgram(options, job) {
    const scriptPath = getRunnerTempScriptPath(job.sessionId, 'py');
    fs.writeFileSync(scriptPath, options.program, 'utf-8');
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

export async function executeJavascriptProgram(options, job) {
    const projectDir = job.projectDir;
    await ensureJavascriptProject(projectDir, options.dependencies);
    const scriptPath = getRunnerTempScriptPath(job.sessionId, 'mts');
    const scriptBody = `${createJavascriptPrelude(options.cwd, scriptPath)}${rewriteJavascriptModuleSpecifiers(options.program, options.cwd)}`;
    fs.writeFileSync(scriptPath, `${scriptBody}\n`, 'utf-8');
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

function createJavascriptPrelude(cwd, scriptPath) {
    return [
        'import { createRequire } from "node:module";',
        `const require = createRequire(${JSON.stringify(path.join(cwd, '__runner__.cjs'))});`,
        `const __dirname = ${JSON.stringify(path.dirname(scriptPath))};`,
        `const __filename = ${JSON.stringify(scriptPath)};`,
        '',
    ].join('\n');
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
