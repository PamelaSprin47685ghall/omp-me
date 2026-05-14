/**
 * Physical real-environment end-to-end tests.
 *
 * Shared lifecycle: start OMP in tmux → send /squad → poll for UI URL → run tests.
 * Baseline assertions first, then chaos/stress, then wait for squad completion.
 *
 * Reduces real-env setup overhead by ~50% vs separate files.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

function fileExists(fp) {
    return Bun.spawnSync({ cmd: ['test', '-f', fp] }).exitCode === 0;
}

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

describe('Real Environment Physical', () => {
    let tmuxSess;
    let testDir;
    let uiUrl;
    let browser;
    let page;
    const messages = [];

    beforeAll(async () => {
        console.log('[setup] starting');
        testDir = `/tmp/squad-physical-${Date.now()}`;
        tmuxSess = `squad-physical-${process.pid}`;
        const pluginPath = path.resolve(process.cwd(), 'index.js');
        const model = process.env.SQUAD_MODEL;
        const modelArgs = model ? ['--model', model] : [];

        console.log('[setup] testDir:', testDir, 'model:', model || 'default');
        Bun.spawnSync({ cmd: ['mkdir', '-p', testDir] });
        Bun.spawnSync({
            cmd: ['tmux', 'new-session', '-d', '-s', tmuxSess, '-c', testDir, 'omp', ...modelArgs, '-e', pluginPath],
        });
        console.log('[setup] tmux session created:', tmuxSess);

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
        console.log('[setup] /squad sent, polling for URL...');

        await pollFor(
            () => {
                const r = Bun.spawnSync({ cmd: ['tmux', 'capture-pane', '-t', tmuxSess, '-p', '-S', '-20'] });
                const m = new TextDecoder().decode(r.stdout).match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
                return m ? ((uiUrl = m[1]), console.log('[setup] URL:', uiUrl), true) : null;
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
        console.log('[teardown] cleanup');
        if (browser) await teardownBrowser(browser);
        try {
            Bun.spawnSync({ cmd: ['tmux', 'kill-session', '-t', tmuxSess] });
        } catch {}
    });

    // ──────────────────────────────────────────────
    // BASELINE ASSERTIONS
    // ──────────────────────────────────────────────

    test('Browser mounts the app shell', async () => {
        await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForSelector('[data-app-title]', { timeout: 10000 });
        const title = await page.$eval('[data-app-title]', (el) => el.textContent);
        expect(title).toBe('Squad-Tau');
    });

    test('HTTP /api/status returns ok', async () => {
        const resp = await fetch(`${uiUrl}/api/status`);
        expect(resp.status).toBe(200);
        const data = await resp.json();
        expect(data.status).toBe('ok');
        expect(typeof data.port).toBe('number');
    });

    test('HTTP /main.jsx serves the client bundle', async () => {
        const resp = await fetch(`${uiUrl}/main.jsx`);
        expect(resp.status).toBe(200);
        expect(resp.headers.get('content-type')).toContain('javascript');
        const text = await resp.text();
        expect(text).toContain('createRoot');
    });

    // ──────────────────────────────────────────────
    // CHAOS / STRESS
    // ──────────────────────────────────────────────

    test('WS survives rapid reconnections', async () => {
        console.log('[test] WS reconnect x5');
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const counts = [];
        for (let i = 0; i < 5; i++) {
            try {
                const pongs = await wsPingPong(wsUrl, 3, 5000);
                counts.push(pongs.length);
            } catch {
                counts.push(0);
            }
        }
        expect(counts.every((c) => c >= 3)).toBe(true);
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
        expect((await Promise.all(httpStorm)).every((s) => s === 200)).toBe(true);
        expect((await Promise.all(wsStorm)).every((c) => c >= 3)).toBe(true);
    }, 20000);

    // ──────────────────────────────────────────────
    // SQUAD PROGRESS & COMPLETION
    // ──────────────────────────────────────────────

    test('WebSocket receives squad init event', async () => {
        console.log('[test] waiting for squad:init...');
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const initPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('init timeout')), 180000);
            ws.onmessage = (event) => {
                try {
                    const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
                    const msg = JSON.parse(raw);
                    if (msg.type === 'squad:init') {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(msg);
                    }
                } catch {}
            };
            ws.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('WS error'));
            };
        });

        const init = await initPromise;
        console.log('[test] got squad:init, mode:', init.payload.mode, 'nodes:', init.payload.nodes.length);
        expect(init.payload).toBeDefined();
        expect(init.payload.mode).toMatch(/^[ML]$/);
        expect(Array.isArray(init.payload.nodes)).toBe(true);
    }, 190000);

    test('squad completion marker is written', async () => {
        console.log('[test] waiting for .squad-complete...');
        const markerPath = `${testDir}/.squad-complete`;
        const markerRaw = await pollFor(
            () => {
                if (!fileExists(markerPath)) return null;
                const r = Bun.spawnSync({ cmd: ['cat', markerPath] });
                return new TextDecoder().decode(r.stdout);
            },
            600000,
            5000,
        );
        const marker = JSON.parse(markerRaw);
        console.log('[test] complete! nodes:', marker.nodes, 'duration:', (marker.durationMs / 1000).toFixed(1) + 's');
        expect(marker.completedAt).toBeGreaterThan(0);
        expect(marker.durationMs).toBeGreaterThan(0);
        expect(marker.nodes).toBeGreaterThanOrEqual(1);
    }, 610000);
});
