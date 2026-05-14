import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

function fileExists(fp) {
    return Bun.spawnSync({ cmd: ['test', '-f', fp] }).exitCode === 0;
}

/** Poll every `interval` ms until `predicate` returns truthy, then resolve with it. */
async function pollFor(predicate, timeoutMs = 30000, interval = 500) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const result = predicate();
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`pollFor timed out after ${timeoutMs}ms`);
}

function wsPingPong(wsUrl, count, timeoutMs) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const pongs = [];
        const timeout = setTimeout(() => {
            try {
                ws.close();
            } catch {}
            reject(new Error('timeout'));
        }, timeoutMs);

        ws.onopen = () => {
            for (let i = 0; i < count; i++) ws.send(JSON.stringify({ type: 'ping' }));
        };

        ws.onmessage = (event) => {
            try {
                const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
                const msg = JSON.parse(raw);
                if (msg.type === 'pong') {
                    pongs.push(msg);
                    if (pongs.length >= count) {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(pongs);
                    }
                }
            } catch {}
        };

        ws.onerror = () => {
            clearTimeout(timeout);
            try {
                ws.close();
            } catch {}
            reject(new Error('WS error'));
        };
    });
}

/** Wait for WebSocket to fully close, then resolve. */
function waitForWsClose(ws) {
    return new Promise((resolve, reject) => {
        const guard = setTimeout(() => resolve(), 3000);
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            clearTimeout(guard);
            resolve();
            return;
        }
        ws.onclose = () => {
            clearTimeout(guard);
            resolve();
        };
        ws.onerror = () => {
            clearTimeout(guard);
            resolve();
        };
        try {
            ws.close();
        } catch {
            clearTimeout(guard);
            resolve();
        }
    });
}

describe('Real Environment Chaos', () => {
    let tmuxSess;
    let testDir;
    let uiUrl;
    let browser;
    let page;

    beforeAll(async () => {
        console.log('[setup] starting chaos');
        testDir = `/tmp/squad-chaos-${Date.now()}`;
        tmuxSess = `squad-chaos-${process.pid}`;
        const pluginPath = path.resolve(process.cwd(), 'index.js');
        const model = process.env.SQUAD_MODEL;
        const modelArgs = model ? ['--model', model] : [];

        console.log('[setup] testDir:', testDir, 'model:', model || 'default');
        Bun.spawnSync({ cmd: ['mkdir', '-p', testDir] });
        Bun.spawnSync({
            cmd: ['tmux', 'new-session', '-d', '-s', tmuxSess, '-c', testDir, 'omp', ...modelArgs, '-e', pluginPath],
        });
        console.log('[setup] tmux created:', tmuxSess);

        // Wait for CLI to be ready by polling for tmux pane output
        await pollFor(
            () => {
                const r = Bun.spawnSync({ cmd: ['tmux', 'capture-pane', '-t', tmuxSess, '-p', '-S', '-5'] });
                return new TextDecoder().decode(r.stdout).includes('omp') ? true : null;
            },
            15000,
            500,
        );
        console.log('[setup] CLI ready, sending /squad');

        Bun.spawnSync({
            cmd: [
                'tmux',
                'send-keys',
                '-t',
                tmuxSess,
                '/squad 在当前目录写一个简单的计算器程序，支持加减乘除，用 JavaScript 实现',
                'C-m',
            ],
        });
        console.log('[setup] /squad sent, polling URL...');

        let attempt = 0;
        await pollFor(
            () => {
                attempt++;
                const r = Bun.spawnSync({ cmd: ['tmux', 'capture-pane', '-t', tmuxSess, '-p', '-S', '-20'] });
                const m = new TextDecoder().decode(r.stdout).match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
                if (m) {
                    uiUrl = m[1];
                    console.log('[setup] URL found after', attempt, 'attempts:', uiUrl);
                    return true;
                }
                return null;
            },
            30000,
            500,
        );
        if (!uiUrl) throw new Error('Failed to get Squad UI URL');

        const launched = await setupBrowser();
        browser = launched.browser;
        page = launched.page;
    }, 60000);

    afterAll(async () => {
        console.log('[teardown] chaos cleanup');
        if (browser) await teardownBrowser(browser);
        try {
            Bun.spawnSync({ cmd: ['tmux', 'kill-session', '-t', tmuxSess] });
        } catch {}
    });

    test('Browser mounts the app shell', async () => {
        await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForSelector('[data-app-title]', { timeout: 10000 });
        const title = await page.$eval('[data-app-title]', (element) => element.textContent);
        expect(title).toBe('Squad-Tau');
    });

    test('HTTP /main.jsx serves the client bundle', async () => {
        const resp = await fetch(`${uiUrl}/main.jsx`);
        expect(resp.status).toBe(200);
        expect(resp.headers.get('content-type')).toContain('javascript');
        const text = await resp.text();
        expect(text).toContain('createRoot');
    });

    test('WS survives rapid reconnections', async () => {
        console.log('[test] WS reconnect x5');
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const counts = [];
        for (let i = 0; i < 5; i++) {
            try {
                const ws = new WebSocket(wsUrl);
                const pongs = await wsPingPong(wsUrl, 3, 5000);
                counts.push(pongs.length);
                await waitForWsClose(ws);
            } catch {
                counts.push(0);
            }
        }
        expect(counts.every((count) => count >= 3)).toBe(true);
    }, 30000);

    test('concurrent HTTP + WS stress does not crash server', async () => {
        console.log('[test] stress: 10 HTTP + 3 WS concurrent');
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const httpStorm = Array.from({ length: 10 }, async () => {
            try {
                return (await fetch(`${uiUrl}/api/status`)).status;
            } catch {
                return 503;
            }
        });
        const wsStorm = Array.from({ length: 3 }, async () => {
            try {
                return (await wsPingPong(wsUrl, 3, 8000)).length;
            } catch {
                return 0;
            }
        });
        expect((await Promise.all(httpStorm)).every((status) => status === 200)).toBe(true);
        expect((await Promise.all(wsStorm)).every((count) => count >= 3)).toBe(true);
    }, 20000);

    test('squad still completes after chaos stress', async () => {
        console.log('[test] waiting for .squad-complete...');
        const markerPath = `${testDir}/.squad-complete`;
        const markerRaw = await pollFor(
            () => {
                if (!fileExists(markerPath)) return null;
                const r = Bun.spawnSync({ cmd: ['cat', markerPath] });
                return new TextDecoder().decode(r.stdout);
            },
            900000,
            5000,
        );
        const marker = JSON.parse(markerRaw);
        console.log('[test] complete! nodes:', marker.nodes, 'duration:', (marker.durationMs / 1000).toFixed(1) + 's');
        expect(marker.completedAt).toBeGreaterThan(0);
        expect(marker.durationMs).toBeGreaterThan(0);
        expect(marker.nodes).toBeGreaterThanOrEqual(1);
    }, 910000);
});
