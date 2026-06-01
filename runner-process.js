import { spawn } from 'node:child_process';

export function killProcessTree(childProcess) {
    const pid = childProcess?.pid;
    if (!pid) return;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
            return;
        }
        spawn('kill', '-9', `-${pid}`, { stdio: 'ignore' });
    } catch {
        try {
            childProcess.kill('SIGKILL');
        } catch {}
    }
}

export function runChildProcess({ command, args, cwd, env, signal, timeoutMs }) {
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
        childProcess.stdout.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
        childProcess.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });

        const onAbort = () => killProcessTree(childProcess);
        const onTimeout = () => killProcessTree(childProcess);

        signal?.addEventListener('abort', onAbort, { once: true });
        const timeoutId = timeoutMs && timeoutMs > 0 ? setTimeout(onTimeout, timeoutMs) : null;

        childProcess.on('error', (error) => {
            signal?.removeEventListener('abort', onAbort);
            if (timeoutId) clearTimeout(timeoutId);
            reject(error);
        });

        childProcess.on('close', (code) => {
            signal?.removeEventListener('abort', onAbort);
            if (timeoutId) clearTimeout(timeoutId);
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error((`${stdout}${stderr}`).trim() || `${command} exited with code ${code}`));
        });
    });
}
