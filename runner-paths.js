import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

export const RUNNER_LOG_DIR = path.join(tmpdir(), 'omp-kunwei-runner');
export const RUNNER_EARLY_TIMEOUT_MS = 5000;
export const RUNNER_MAX_WAIT_MS = 30000;
export const RUNNER_MIN_WAIT_MS = 100;
export const HEAD_TAIL_PIPE_RE = /\s*\|\s*(head|tail)(?:\s+[^\s|&;()<>\n#`>]+)*/g;

export const RUNNER_LANGUAGES = ['shell', 'python', 'javascript'];

export function ensureRunnerDir() {
    fs.mkdirSync(RUNNER_LOG_DIR, { recursive: true });
}

export function getRunnerLogPath(sessionId) {
    ensureRunnerDir();
    return path.join(RUNNER_LOG_DIR, `runner-${sessionId}.log`);
}

export function getRunnerProjectDir(sessionId) {
    ensureRunnerDir();
    return path.join(RUNNER_LOG_DIR, `runner-${sessionId}`);
}

export function getRunnerTempScriptPath(sessionId, extension) {
    ensureRunnerDir();
    return path.join(RUNNER_LOG_DIR, `.runner-${sessionId}.${extension}`);
}

export function openLogStream(logPath) {
    return fs.createWriteStream(logPath, { flags: 'a' });
}

export function pipeToLog(logStream, source) {
    source.on('data', (chunk) => {
        if (logStream.destroyed || logStream.writableEnded) return;
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        if (!logStream.write(text) && source.pause) source.pause();
    });
    logStream.on('drain', () => {
        if (source.isPaused?.()) source.resume();
    });
}

export function closeLogStream(logStream) {
    return new Promise((resolve) => {
        if (!logStream || logStream.destroyed) return resolve();
        logStream.end(() => resolve());
    });
}

export function destroyLogStream(logStream) {
    if (!logStream || logStream.destroyed) return;
    try { logStream.destroy(); } catch {}
}

export function ensureTrailingNewline(text) {
    if (!text) return '';
    return text.endsWith('\n') ? text : `${text}\n`;
}

export function readCurrentOutput(logPath) {
    return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').trim() || '(no output)' : '(no output)';
}
