/**
 * Real Environment E2E — Tests Squad-Tau with actual OMP in tmux.
 * Verifies: HTTP API, WebSocket events, file creation, squad completion.
 * Uses tmux + curl (no mocks) — the plugin talks to real OMP sessions.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForTmuxOutput(session, pattern, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const { stdout } = await execAsync(`tmux capture-pane -t ${session} -p 2>/dev/null | tail -20`);
            if (stdout.match(pattern)) return stdout;
        } catch {}
        await sleep(1000);
    }
    throw new Error(`Timeout waiting for pattern in tmux session ${session}`);
}

async function getSquadUiUrl(session, timeoutMs = 30000) {
    const output = await waitForTmuxOutput(session, /Squad UI: http:\/\/127\.0\.0\.1:\d+/, timeoutMs);
    const match = output.match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
    return match ? match[1] : null;
}

describe('Real Environment E2E', () => {
    let tmuxSession;
    let testDir;
    let uiUrl;
    let ws;
    const messages = [];

    beforeAll(async () => {
        testDir = `/tmp/squad-real-e2e-${Date.now()}`;
        tmuxSession = `squad-real-e2e-${process.pid}`;
        const pluginPath = path.resolve(process.cwd(), 'index.js');

        await execAsync(`mkdir -p ${testDir}`);

        // Start OMP in tmux
        const cmd = `cd ${testDir} && SQUAD_E2E=1 omp -e ${pluginPath}`;
        await execAsync(`tmux new-session -d -s ${tmuxSession} "${cmd}"`);
        await sleep(3000);

        // Send /squad command
        await execAsync(
            `tmux send-keys -t ${tmuxSession} "/squad 在当前目录写一个简单的计算器程序，支持加减乘除，用 JavaScript 实现" C-m`,
        );

        // Capture UI URL
        uiUrl = await getSquadUiUrl(tmuxSession, 30000);
        if (!uiUrl) throw new Error('Failed to get Squad UI URL');
    }, 60000);

    afterAll(async () => {
        if (ws) {
            try {
                ws.close();
            } catch {}
        }
        try {
            await execAsync(`tmux kill-session -t ${tmuxSession} 2>/dev/null || true`);
        } catch {}
    });

    test('HTTP /api/status returns ok', async () => {
        const resp = await fetch(`${uiUrl}/api/status`);
        expect(resp.status).toBe(200);
        const data = await resp.json();
        expect(data.status).toBe('ok');
        expect(typeof data.port).toBe('number');
    });

    test('HTTP / serves index.html or Vite is warming up', async () => {
        const resp = await fetch(uiUrl);
        // Vite dev server may return 404 briefly on first boot
        expect([200, 404]).toContain(resp.status);
        if (resp.status === 200) {
            const text = await resp.text();
            expect(text).toContain('<div id="root"></div>');
        }
    });

    test('WebSocket connects and receives snapshot', async () => {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        ws = new WebSocket(wsUrl);

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('WS timeout')), 10000);
            ws.onopen = () => {
                clearTimeout(timer);
                resolve();
            };
            ws.onerror = () => {
                clearTimeout(timer);
                reject(new Error('WS error'));
            };
        });

        ws.onmessage = (event) => {
            try {
                messages.push(JSON.parse(event.data));
            } catch {}
        };

        // Wait for snapshot
        await sleep(2000);
        const snapshot = messages.find((m) => m.type === 'model_pool:snapshot');
        expect(snapshot).toBeDefined();
        expect(snapshot.payload).toBeDefined();
    }, 15000);

    test('WebSocket receives squad init event', async () => {
        // Wait for squad init from real OMP — architect may take 60-180s to create plan
        const start = Date.now();
        while (Date.now() - start < 180000) {
            const init = messages.find((m) => m.type === 'squad:init');
            if (init) {
                expect(init.payload).toBeDefined();
                expect(init.payload.mode).toMatch(/^[ML]$/);
                expect(Array.isArray(init.payload.nodes)).toBe(true);
                return;
            }
            await sleep(1000);
        }
        throw new Error('No squad init event received');
    }, 190000);

    test('WebSocket receives node_state events', async () => {
        const start = Date.now();
        while (Date.now() - start < 300000) {
            const nodeState = messages.find((m) => m.type === 'squad:node_state');
            if (nodeState) {
                expect(nodeState.payload.nodeId).toBeDefined();
                expect(nodeState.payload.status).toBeDefined();
                return;
            }
            await sleep(1000);
        }
        throw new Error('No node_state event received');
    }, 310000);

    test('JavaScript files are created by squad', async () => {
        const start = Date.now();
        while (Date.now() - start < 300000) {
            try {
                const { stdout } = await execAsync(`ls ${testDir}/*.js 2>/dev/null || true`);
                if (stdout.trim().length > 0) return;
            } catch {
                /* ignore */
            }
            await sleep(2000);
        }
        throw new Error('No JavaScript files were created');
    }, 310000);

    test('squad completion marker is written', async () => {
        const start = Date.now();
        while (Date.now() - start < 600000) {
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
        throw new Error('Squad completion marker not found');
    }, 610000);
});
