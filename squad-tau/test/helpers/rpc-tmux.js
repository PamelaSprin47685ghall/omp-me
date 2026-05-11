import { spawn } from 'node:child_process';
import { openSync, readSync, closeSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUTPUT_FILE = join(tmpdir(), 'omp-rpc-output.log');
let proc = null;
let lastReadOffset = 0;
const seen = new Set();

function isAlive(p) {
    return p && p.exitCode === null && !p.killed;
}

export async function setupRpc() {
    await teardownRpc();
    seen.clear();
    if (existsSync(OUTPUT_FILE)) unlinkSync(OUTPUT_FILE);
    lastReadOffset = 0;

    const cmd = 'exec omp --mode rpc >> ' + OUTPUT_FILE + ' 2>&1';
    proc = spawn('bash', ['-c', cmd], { stdio: ['pipe', 'pipe', 'inherit'] });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (!isAlive(proc)) throw new Error(`OMP process died during startup (exitCode=${proc?.exitCode})`);
        if (existsSync(OUTPUT_FILE)) {
            const sz = statSync(OUTPUT_FILE).size;
            if (sz > 0) {
                const fd = openSync(OUTPUT_FILE, 'r');
                const buf = Buffer.alloc(sz);
                readSync(fd, buf, 0, sz, 0);
                closeSync(fd);
                const content = buf.toString('utf-8');
                if (content.includes('"type":"ready"')) {
                    lastReadOffset = sz;
                    return;
                }
            }
        }
        await Bun.sleep(100);
    }
    const exit = proc?.exitCode;
    const output = existsSync(OUTPUT_FILE)
        ? readSync(openSync(OUTPUT_FILE, 'r'), Buffer.alloc(1024), 0, 1024, 0).toString()
        : 'no output';
    await teardownRpc();
    throw new Error(`OMP RPC failed to start within 10s. exitCode=${exit}. Last output: ${output}`);
}

export async function isSquadTauLoaded() {
    const id = `check-squad-${Date.now()}`;
    // Sending a prompt is more reliable than checking state which might contain context words
    await rpcSend({ id, type: 'prompt', message: '/squad' });
    try {
        const resp = await waitForResponse(id, 10000);
        const output = resp.data?.output || '';
        return output.includes('Usage: /squad') || output.includes('Squad-Tau');
    } catch (e) {
        return false;
    }
}

export async function rpcSend(json) {
    if (!isAlive(proc)) throw new Error('OMP process not alive (exitCode=' + proc?.exitCode + ')');
    const payload = (typeof json === 'string' ? json : JSON.stringify(json)) + '\n';
    const ok = proc.stdin.write(payload);
    if (!ok) await new Promise((r) => proc.stdin.once('drain', r));
}

export async function rpcRead() {
    if (!existsSync(OUTPUT_FILE)) return '';
    try {
        const sz = statSync(OUTPUT_FILE).size;
        if (sz <= lastReadOffset) return '';
        const buf = Buffer.alloc(sz - lastReadOffset);
        const fd = openSync(OUTPUT_FILE, 'r');
        readSync(fd, buf, 0, buf.length, lastReadOffset);
        closeSync(fd);
        lastReadOffset = sz;
        return buf.toString('utf-8');
    } catch {
        return '';
    }
}

export async function waitForResponse(commandId, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (!isAlive(proc)) throw new Error('OMP process died mid-response');
        const newText = await rpcRead();
        if (newText) {
            for (const line of newText.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('{') || seen.has(trimmed)) continue;
                seen.add(trimmed);
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj.type === 'response' && obj.id === commandId) return obj;
                } catch {}
            }
        }
        await Bun.sleep(100);
    }
    throw new Error(`Timeout waiting for RPC response id=${commandId}`);
}

export async function waitForEvent(eventType, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (!isAlive(proc)) throw new Error('OMP process died mid-event');
        const newText = await rpcRead();
        if (newText) {
            for (const line of newText.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('{') || seen.has(trimmed)) continue;
                seen.add(trimmed);
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj.type === eventType) return obj;
                } catch {}
            }
        }
        await Bun.sleep(100);
    }
    throw new Error(`Timeout waiting for event: ${eventType}`);
}

export async function collectEvents(durationMs = 5000) {
    const events = [];
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
        if (!isAlive(proc)) break;
        const newText = await rpcRead();
        if (newText) {
            for (const line of newText.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('{') || seen.has(trimmed)) continue;
                seen.add(trimmed);
                try {
                    events.push(JSON.parse(trimmed));
                } catch {}
            }
        }
        await Bun.sleep(100);
    }
    return events;
}

export async function teardownRpc() {
    if (proc) {
        try {
            // Kill the entire process group if possible, or at least the process
            proc.kill('SIGKILL');
            if (proc.pid) {
                // Defensive kill in case of bash wrappers
                try {
                    spawn('pkill', ['-9', '-P', proc.pid.toString()]);
                } catch {}
            }
        } catch {}
        proc = null;
    }
    if (existsSync(OUTPUT_FILE)) {
        try {
            unlinkSync(OUTPUT_FILE);
        } catch {}
    }
}
