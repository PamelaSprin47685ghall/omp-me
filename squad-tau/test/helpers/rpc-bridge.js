/**
 * PhysicalBridge — Ghost Terminal for OMP RPC.
 *
 * Starts a real `omp --mode rpc` process, communicates via JSONL on stdio.
 * Used ONLY in physical-layer tests (rpc-physical.test.js, simulation.js).
 *
 * API:
 *   start()           — spawn omp, wait for 'ready' event
 *   send(json)        — write a JSON command to stdin
 *   waitFor(fn, t)    — wait until fn(obj) returns truthy
 *   stop()            — kill process, clean up
 *
 * Event-driven: parsed JSONL objects emitted as events.
 * No files, no polling, no timers (except timeout guard).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

let _proc = null;
let _emitter = null;
let _rl = null;
let _pendingTimers = [];

function isAlive(p) {
    return p && p.exitCode === null && !p.killed;
}

function parseJSONL(line) {
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
        if (!_emitter) return reject(new Error('RPC not started'));
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
            _emitter.off('data', onData);
            _emitter.off('end', onEnd);
        };

        _emitter.on('data', onData);
        _emitter.on('end', onEnd);
        if (timeout) {
            timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timeout after ${timeout}ms`));
            }, timeout);
            _pendingTimers.push(timer);
        }
    });
}

/**
 * Start OMP RPC process. Returns once the 'ready' event is received.
 * @param {string} [pluginPath] — path to the squad plugin entry point
 * @param {number} [timeout=15000]
 * @returns {Promise<void>}
 */
/**
 * Check if 'omp' executable is available on PATH.
 * Tries 'which' (Unix) and 'where' (Windows).
 */
export function isOmpAvailable() {
    for (const cmd of ['where', 'which']) {
        try {
            const r = Bun.spawnSync({ cmd: [cmd, 'omp'] });
            if (r.exitCode === 0 && r.stdout.toString().trim().length > 0) return true;
        } catch {}
    }
    return false;
}

export async function start(pluginPath, timeout = 15000) {
    if (!isOmpAvailable()) {
        throw new Error('OMP not available on PATH');
    }

    await stop();

    _emitter = new EventEmitter();
    const extraArgs = pluginPath ? ['-e', pluginPath] : [];

    _proc = spawn('omp', ['--mode', 'rpc', ...extraArgs], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env },
    });

    _rl = createInterface({ input: _proc.stdout });
    _rl.on('line', (line) => {
        const obj = parseJSONL(line);
        if (obj && _emitter) _emitter.emit('data', obj);
    });
    _rl.on('close', () => {
        if (_emitter) _emitter.emit('end');
    });
    _proc.on('error', () => {
        if (_emitter) _emitter.emit('end');
    });

    try {
        await _waitForMatch((obj) => (obj.type === 'ready' ? true : undefined), timeout);
    } catch (err) {
        const exit = _proc?.exitCode;
        await stop();
        throw new Error(`OMP RPC start failed. exitCode=${exit}: ${err.message}`);
    }
}

/**
 * Send a JSON command to the OMP RPC process stdin.
 * @param {object|string} json
 */
export async function send(json) {
    if (!isAlive(_proc)) throw new Error('OMP process dead');
    const payload = (typeof json === 'string' ? json : JSON.stringify(json)) + '\n';
    if (!_proc.stdin.write(payload)) {
        await new Promise((r) => _proc.stdin.once('drain', r));
    }
}

/**
 * Wait for a predicate to match an incoming event.
 * @param {function} fn — predicate(obj) → truthy value or undefined
 * @param {number} [timeout=30000]
 * @returns {Promise<any>} — the value returned by fn
 */
export function waitForMatch(fn, timeout = 30000) {
    return _waitForMatch(fn, timeout);
}

/**
 * Wait for a specific event type.
 * @param {string} eventType
 * @param {number} [timeout=30000]
 * @returns {Promise<object>}
 */
export function waitForEvent(eventType, timeout = 30000) {
    return _waitForMatch((obj) => (obj.type === eventType ? obj : undefined), timeout);
}

/**
 * Wait for a response matching a specific id.
 * @param {string} commandId
 * @param {number} [timeout=30000]
 * @returns {Promise<object>}
 */
export function waitForResponse(commandId, timeout = 30000) {
    return _waitForMatch((obj) => (obj.type === 'response' && obj.id === commandId ? obj : undefined), timeout);
}

/**
 * Kill the RPC process and clean up resources.
 */
export async function stop() {
    for (const t of _pendingTimers) clearTimeout(t);
    _pendingTimers = [];
    if (_rl) {
        _rl.close();
        _rl = null;
    }
    if (_emitter) {
        _emitter.removeAllListeners();
        _emitter = null;
    }
    if (_proc) {
        try {
            _proc.kill('SIGKILL');
        } catch {}
        _proc = null;
    }
}
