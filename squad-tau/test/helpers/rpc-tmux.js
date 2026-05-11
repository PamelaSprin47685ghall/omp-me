/**
 * RPC helper for testing OMP — purely event-driven, in-memory.
 * Reads JSONL directly from the process's stdout stream via readline.
 * No files, no polling, no timers.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

let proc = null;
let emitter = null;
let rl = null;

function isAlive(p) {
    return p && p.exitCode === null && !p.killed;
}

function parseLine(line) {
    const s = line.trim();
    if (!s.startsWith('{')) return null;
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function _waitForMatch(fn, timeout) {
    return new Promise((resolve, reject) => {
        if (!emitter) return reject(new Error('RPC not started'));
        let timer = null;

        const onData = (obj) => {
            const r = fn(obj);
            if (r !== undefined) {
                cleanup();
                resolve(r);
            }
        };
        const onEnd = () => {
            cleanup();
            reject(new Error('RPC process ended'));
        };
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            emitter.off('data', onData);
            emitter.off('end', onEnd);
        };

        emitter.on('data', onData);
        emitter.on('end', onEnd);

        if (timeout)
            timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout ${timeout}ms`));
            }, timeout);
    });
}

export async function setupRpc() {
    await teardownRpc();
    emitter = new EventEmitter();

    proc = spawn('bash', ['-c', 'exec stdbuf -oL omp --mode rpc 2>&1'], {
        stdio: ['pipe', 'pipe', 'inherit'],
    });

    rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
        const obj = parseLine(line);
        if (obj && emitter) emitter.emit('data', obj);
    });
    rl.on('close', () => {
        if (emitter) emitter.emit('end');
    });
    proc.on('error', () => {
        if (emitter) emitter.emit('end');
    });

    try {
        await _waitForMatch((obj) => (obj.type === 'ready' ? true : undefined), 10000);
    } catch (err) {
        const exit = proc?.exitCode;
        await teardownRpc();
        throw new Error(`OMP RPC start failed. exitCode=${exit}: ${err.message}`);
    }
}

export async function isSquadTauLoaded() {
    const id = `check-squad-${Date.now()}`;
    await rpcSend({ id, type: 'prompt', message: '/squad' });
    try {
        const resp = await waitForResponse(id, 10000);
        const output = resp.data?.output || '';
        return output.includes('Usage: /squad') || output.includes('Squad-Tau');
    } catch {
        return false;
    }
}

export async function rpcSend(json) {
    if (!isAlive(proc)) throw new Error('OMP process dead');
    const payload = (typeof json === 'string' ? json : JSON.stringify(json)) + '\n';
    if (!proc.stdin.write(payload)) await new Promise((r) => proc.stdin.once('drain', r));
}

export function rpcRead() {
    return '';
}

export function waitForResponse(commandId, timeout = 30000) {
    return _waitForMatch((obj) => (obj.type === 'response' && obj.id === commandId ? obj : undefined), timeout);
}

export function waitForMatch(fn, timeout) {
    return _waitForMatch(fn, timeout);
}

export function waitForEvent(eventType, timeout = 30000) {
    return _waitForMatch((obj) => (obj.type === eventType ? obj : undefined), timeout);
}

export async function teardownRpc() {
    if (rl) {
        rl.close();
        rl = null;
    }
    if (emitter) {
        emitter.removeAllListeners();
        emitter = null;
    }
    if (proc) {
        try {
            proc.kill('SIGKILL');
        } catch {}
        proc = null;
    }
}
