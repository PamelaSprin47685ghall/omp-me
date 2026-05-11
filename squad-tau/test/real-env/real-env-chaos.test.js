/**
 * Real Environment Chaos — Stability test during live Squad execution.
 * Starts a real /squad run in tmux, then hammers HTTP + WS while
 * the architect/worker/reviewer lifecycle progresses.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function getSquadUiUrl(session, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const { stdout } = await execAsync(`tmux capture-pane -t ${session} -p 2>/dev/null | tail -20`);
            const match = stdout.match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
            if (match) return match[1];
        } catch {}
        await sleep(1000);
    }
    throw new Error('Failed to get Squad UI URL');
}

async function wsPingPong(wsUrl, count = 5, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const pongs = [];
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`WS ping-pong timeout after ${pongs.length} pongs`));
        }, timeoutMs);

        ws.onopen = () => {
            for (let i = 0; i < count; i++) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(
                    typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data),
                );
                if (msg.type === 'pong') {
                    pongs.push(msg);
                    if (pongs.length >= count) {
                        clearTimeout(timer);
                        ws.close();
                        resolve(pongs);
                    }
                }
            } catch {}
        };

        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('WS error'));
        };
    });
}

describe('Real Environment Chaos', () => {
    let tmuxSession;
    let testDir;
    let uiUrl;
    const messages = [];

    beforeAll(async () => {
        testDir = `/tmp/squad-real-chaos-${Date.now()}`;
        tmuxSession = `squad-real-chaos-${process.pid}`;
        const pluginPath = path.resolve(process.cwd(), 'index.js');

        await execAsync(`mkdir -p ${testDir}`);
        const cmd = `cd ${testDir} && SQUAD_E2E=1 omp -e ${pluginPath}`;
        await execAsync(`tmux new-session -d -s ${tmuxSession} "${cmd}"`);
        await sleep(3000);

        await execAsync(
            `tmux send-keys -t ${tmuxSession} "/squad 在当前目录写一个简单的计算器程序，支持加减乘除，用 JavaScript 实现" C-m`,
        );

        uiUrl = await getSquadUiUrl(tmuxSession, 30000);
        if (!uiUrl) throw new Error('Failed to get Squad UI URL');
    }, 60000);

    afterAll(async () => {
        try {
            await execAsync(`tmux kill-session -t ${tmuxSession} 2>/dev/null || true`);
        } catch {}
    });

    test('HTTP health remains 200 during squad execution', async () => {
        const results = [];
        for (let i = 0; i < 20; i++) {
            const resp = await fetch(`${uiUrl}/api/status`);
            results.push(resp.status);
            await sleep(500);
        }
        expect(results.every((s) => s === 200)).toBe(true);
    }, 15000);

    test('WebSocket survives rapid reconnections during squad execution', async () => {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const sessions = [];

        for (let i = 0; i < 5; i++) {
            const pongs = await wsPingPong(wsUrl, 3, 5000);
            sessions.push(pongs.length);
            await sleep(500);
        }

        expect(sessions.every((c) => c >= 3)).toBe(true);
    }, 30000);

    test('concurrent HTTP + WS stress does not crash server', async () => {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';

        const httpStorm = Array.from({ length: 10 }, async () => {
            const resp = await fetch(`${uiUrl}/api/status`);
            return resp.status;
        });

        const wsStorm = Array.from({ length: 3 }, async () => {
            const pongs = await wsPingPong(wsUrl, 3, 8000);
            return pongs.length;
        });

        const httpResults = await Promise.all(httpStorm);
        const wsResults = await Promise.all(wsStorm);

        expect(httpResults.every((s) => s === 200)).toBe(true);
        expect(wsResults.every((c) => c >= 3)).toBe(true);
    }, 20000);

    test('squad still completes after chaos stress', async () => {
        const start = Date.now();
        while (Date.now() - start < 900000) {
            try {
                await execAsync(`test -f ${testDir}/.squad-complete`);
                const { stdout } = await execAsync(`cat ${testDir}/.squad-complete`);
                const marker = JSON.parse(stdout);
                expect(marker.completedAt).toBeGreaterThan(0);
                expect(marker.durationMs).toBeGreaterThan(0);
                expect(marker.nodes).toBeGreaterThanOrEqual(1);
                return;
            } catch {
                await sleep(5000);
            }
        }
        throw new Error('Squad did not complete after chaos stress');
    }, 910000);
});
