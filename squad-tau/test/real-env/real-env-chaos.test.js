import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileExists(fp) {
    return Bun.spawnSync({ cmd: ['test', '-f', fp] }).exitCode === 0;
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

        await sleep(3000);
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

        const end = Date.now() + 30000;
        while (Date.now() < end) {
            const r = Bun.spawnSync({ cmd: ['tmux', 'capture-pane', '-t', tmuxSess, '-p', '-S', '-20'] });
            const out = new TextDecoder().decode(r.stdout);
            const match = out.match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
            if (match) {
                uiUrl = match[1];
                console.log('[setup] URL:', uiUrl);
                break;
            }
            await sleep(1000);
        }
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
        await page.waitForSelector('.app-title', { timeout: 10000 });
        const title = await page.$eval('.app-title', (element) => element.textContent);
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
        const sessions = [];
        for (let i = 0; i < 5; i++) {
            try {
                sessions.push((await wsPingPong(wsUrl, 3, 5000)).length);
            } catch {
                sessions.push(0);
            }
            await sleep(500);
        }
        expect(sessions.every((count) => count >= 3)).toBe(true);
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
        const end = Date.now() + 900000;
        const markerPath = `${testDir}/.squad-complete`;
        while (Date.now() < end) {
            if (!fileExists(markerPath)) {
                await sleep(5000);
                continue;
            }
            const r = Bun.spawnSync({ cmd: ['cat', markerPath] });
            const marker = JSON.parse(new TextDecoder().decode(r.stdout));
            console.log(
                '[test] complete! nodes:',
                marker.nodes,
                'duration:',
                (marker.durationMs / 1000).toFixed(1) + 's',
            );
            expect(marker.completedAt).toBeGreaterThan(0);
            expect(marker.durationMs).toBeGreaterThan(0);
            expect(marker.nodes).toBeGreaterThanOrEqual(1);
            return;
        }
        throw new Error('Squad did not complete after chaos stress');
    }, 910000);
});
