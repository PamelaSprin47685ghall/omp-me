import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileExists(fp) {
    return Bun.spawnSync({ cmd: ['test', '-f', fp] }).exitCode === 0;
}

describe('Real Environment E2E', () => {
    let tmuxSess;
    let testDir;
    let uiUrl;
    let ws;
    let browser;
    let page;
    const messages = [];

    beforeAll(async () => {
        console.log('[setup] starting');
        testDir = `/tmp/squad-e2e-${Date.now()}`;
        tmuxSess = `squad-e2e-${process.pid}`;
        const pluginPath = path.resolve(process.cwd(), 'index.js');
        const model = process.env.SQUAD_MODEL;
        const modelArgs = model ? ['--model', model] : [];

        console.log('[setup] testDir:', testDir);
        console.log('[setup] model:', model || 'default');

        Bun.spawnSync({ cmd: ['mkdir', '-p', testDir] });
        console.log('[setup] mkdir done');

        Bun.spawnSync({
            cmd: ['tmux', 'new-session', '-d', '-s', tmuxSess, '-c', testDir, 'omp', ...modelArgs, '-e', pluginPath],
        });
        console.log('[setup] tmux session created:', tmuxSess);

        await sleep(3000);
        console.log('[setup] sleep done, sending /squad');

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
        console.log('[setup] send-keys done, polling for URL...');

        const end = Date.now() + 30000;
        let attempt = 0;
        while (Date.now() < end) {
            attempt++;
            const r = Bun.spawnSync({ cmd: ['tmux', 'capture-pane', '-t', tmuxSess, '-p', '-S', '-20'] });
            const out = new TextDecoder().decode(r.stdout);
            const m = out.match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
            if (m) {
                uiUrl = m[1];
                console.log('[setup] URL found after', attempt, 'attempts:', uiUrl);
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
        console.log('[teardown] cleaning up');
        if (browser) await teardownBrowser(browser);
        if (ws)
            try {
                ws.close();
            } catch {}
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

    test('WebSocket connects and receives snapshot', async () => {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        ws = new WebSocket(wsUrl);

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('WS timeout')), 10000);
            ws.onopen = () => {
                clearTimeout(timeout);
                resolve();
            };
            ws.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('WS error'));
            };
        });

        ws.onmessage = (event) => {
            try {
                const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
                messages.push(JSON.parse(raw));
            } catch {}
        };

        await sleep(2000);
        const snap = messages.find((message) => message.type === 'model_pool:snapshot');
        expect(snap).toBeDefined();
        expect(snap.payload).toBeDefined();
    }, 15000);

    test('WebSocket receives squad init event', async () => {
        console.log('[test] waiting for squad:init...');
        const end = Date.now() + 180000;
        while (Date.now() < end) {
            const init = messages.find((message) => message.type === 'squad:init');
            if (init) {
                console.log('[test] got squad:init, mode:', init.payload.mode, 'nodes:', init.payload.nodes.length);
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
        console.log('[test] waiting for node_state...');
        const end = Date.now() + 300000;
        while (Date.now() < end) {
            const state = messages.find((message) => message.type === 'squad:node_state');
            if (state) {
                console.log('[test] got node_state:', state.payload.nodeId, state.payload.status);
                expect(state.payload.nodeId).toBeDefined();
                expect(state.payload.status).toBeDefined();
                return;
            }
            await sleep(1000);
        }
        throw new Error('No node_state event received');
    }, 310000);

    test('JavaScript files are created by squad', async () => {
        console.log('[test] waiting for .js files...');
        const end = Date.now() + 300000;
        while (Date.now() < end) {
            const r = Bun.spawnSync({ cmd: ['sh', '-c', `ls '${testDir}'/*.js 2>/dev/null || true`] });
            if (r.exitCode === 0 && new TextDecoder().decode(r.stdout).trim().length > 0) {
                console.log('[test] .js files found');
                return;
            }
            await sleep(2000);
        }
        throw new Error('No JavaScript files were created');
    }, 310000);

    test('squad completion marker is written', async () => {
        console.log('[test] waiting for .squad-complete...');
        const end = Date.now() + 600000;
        const markerPath = `${testDir}/.squad-complete`;
        while (Date.now() < end) {
            if (!fileExists(markerPath)) {
                await sleep(5000);
                continue;
            }
            const r = Bun.spawnSync({ cmd: ['cat', markerPath] });
            const marker = JSON.parse(new TextDecoder().decode(r.stdout));
            console.log(
                '[test] squad complete! nodes:',
                marker.nodes,
                'duration:',
                (marker.durationMs / 1000).toFixed(1) + 's',
            );
            expect(marker.completedAt).toBeGreaterThan(0);
            expect(marker.durationMs).toBeGreaterThan(0);
            expect(marker.nodes).toBeGreaterThanOrEqual(1);
            return;
        }
        throw new Error('Squad completion marker not found');
    }, 610000);
});
