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

        // Wait for CLI to be ready by polling for the squad prompt, then send /squad
        console.log('[setup] polling for CLI readiness...');
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
        console.log('[setup] send-keys done, polling for URL...');

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
        await page.waitForSelector('[data-app-title]', { timeout: 10000 });
        const title = await page.$eval('[data-app-title]', (element) => element.textContent);
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

        // Wait for snapshot event instead of arbitrary sleep
        await pollFor(
            () => {
                const snap = messages.find((message) => message.type === 'model_pool:snapshot');
                return snap || null;
            },
            10000,
            200,
        );
        const snap = messages.find((message) => message.type === 'model_pool:snapshot');
        expect(snap).toBeDefined();
        expect(snap.payload).toBeDefined();
    }, 15000);

    test('WebSocket receives squad init event', async () => {
        console.log('[test] waiting for squad:init...');
        await pollFor(
            () => {
                const init = messages.find((message) => message.type === 'squad:init');
                return init || null;
            },
            180000,
            1000,
        );
        const init = messages.find((message) => message.type === 'squad:init');
        console.log('[test] got squad:init, mode:', init.payload.mode, 'nodes:', init.payload.nodes.length);
        expect(init.payload).toBeDefined();
        expect(init.payload.mode).toMatch(/^[ML]$/);
        expect(Array.isArray(init.payload.nodes)).toBe(true);
    }, 190000);

    test('WebSocket receives node_state events', async () => {
        console.log('[test] waiting for node_state...');
        await pollFor(
            () => {
                const state = messages.find((message) => message.type === 'squad:node_state');
                return state || null;
            },
            300000,
            1000,
        );
        const state = messages.find((message) => message.type === 'squad:node_state');
        console.log('[test] got node_state:', state.payload.nodeId, state.payload.status);
        expect(state.payload.nodeId).toBeDefined();
        expect(state.payload.status).toBeDefined();
    }, 310000);

    test('JavaScript files are created by squad', async () => {
        console.log('[test] waiting for .js files...');
        await pollFor(
            () => {
                const r = Bun.spawnSync({ cmd: ['sh', '-c', `ls '${testDir}'/*.js 2>/dev/null || true`] });
                const out = r.exitCode === 0 ? new TextDecoder().decode(r.stdout).trim() : '';
                return out.length > 0 ? out : null;
            },
            300000,
            2000,
        );
        console.log('[test] .js files found');
    }, 310000);

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
        console.log(
            '[test] squad complete! nodes:',
            marker.nodes,
            'duration:',
            (marker.durationMs / 1000).toFixed(1) + 's',
        );
        expect(marker.completedAt).toBeGreaterThan(0);
        expect(marker.durationMs).toBeGreaterThan(0);
        expect(marker.nodes).toBeGreaterThanOrEqual(1);
    }, 610000);
});
