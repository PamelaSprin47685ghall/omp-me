/**
 * Physical real-environment simulation (v3 — Ghost Terminal, Zero Polling, Zero Disk).
 *
 * Start OMP in tmux → ghost attach PTY memory stream → await CLI ready →
 * send /squad → await Squad UI URL in stream → run baseline + chaos tests.
 *
 * Run explicitly:
 *   SQUAD_MODEL=p-openai/gpt-5.2 bun test ./simulation.js
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { readdirSync, readFileSync } from 'fs';
import { setupBrowser, teardownBrowser } from './test/helpers/puppeteer-setup.js';

let tmuxSess, testDir, uiUrl, browser, page;

function stripAnsi(raw) {
    return raw
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[\(\)][A-Za-z0-9]/g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function attachAndWatch(tmuxSess, predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const proc = Bun.spawn({ cmd: ['tmux', 'attach', '-t', tmuxSess], stdout: 'pipe' });
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`attachAndWatch timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        let rawBuffer = '';
        const decoder = new TextDecoder();
        const maxBuf = 8192;

        async function consume() {
            try {
                for await (const chunk of proc.stdout) {
                    rawBuffer += decoder.decode(chunk, { stream: true });
                    if (rawBuffer.length > maxBuf) {
                        rawBuffer = rawBuffer.slice(-maxBuf);
                    }
                    const clean = stripAnsi(rawBuffer);
                    const result = predicate(clean);
                    if (result) {
                        clearTimeout(timer);
                        proc.kill();
                        resolve(result);
                        return;
                    }
                }
                clearTimeout(timer);
                reject(new Error('PTY stream ended without match'));
            } catch (err) {
                clearTimeout(timer);
                proc.kill();
                reject(err);
            }
        }
        consume();
    });
}

function wsPingPong(wsUrl, count, timeoutMs) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const pongs = [];
        const timer = setTimeout(() => {
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
                        clearTimeout(timer);
                        ws.close();
                        resolve(pongs);
                    }
                }
            } catch {}
        };
        ws.onclose = () => {
            clearTimeout(timer);
            try {
                ws.close();
            } catch {}
            reject(new Error('WS closed'));
        };
        ws.onerror = () => {
            clearTimeout(timer);
            try {
                ws.close();
            } catch {}
            reject(new Error('WS error'));
        };
    });
}

function awaitWsEvent(wsUrl, eventType, timeoutMs) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`${eventType} timeout`));
        }, timeoutMs);

        ws.onmessage = (event) => {
            try {
                const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
                const msg = JSON.parse(raw);
                if (msg.type === eventType) {
                    clearTimeout(timer);
                    ws.close();
                    resolve(msg);
                }
            } catch {}
        };
        ws.onclose = () => {
            clearTimeout(timer);
            reject(new Error('WS closed'));
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('WS error'));
        };
    });
}

beforeAll(async () => {
    testDir = `/tmp/squad-physical-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    tmuxSess = `squad-physical-${process.pid}`;
    const pluginPath = path.resolve(process.cwd(), 'index.js');
    const model = process.env.SQUAD_MODEL;
    const modelArgs = model ? ['--model', model] : [];

    Bun.spawnSync({ cmd: ['mkdir', '-p', testDir] });
    Bun.spawnSync({
        cmd: ['tmux', 'new-session', '-d', '-s', tmuxSess, '-c', testDir, 'omp', ...modelArgs, '-e', pluginPath],
    });

    await attachAndWatch(tmuxSess, (clean) => (clean.includes('omp') ? true : null), 15000);

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

    const urlMatch = await attachAndWatch(
        tmuxSess,
        (clean) => {
            const m = clean.match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
            return m?.[1] || null;
        },
        30000,
    );
    if (!urlMatch) throw new Error('Failed to get Squad UI URL');
    uiUrl = urlMatch;

    const launched = await setupBrowser();
    browser = launched.browser;
    page = launched.page;
}, 60000);

afterAll(async () => {
    if (browser) {
        try {
            await teardownBrowser(browser);
        } catch {}
    }
    if (tmuxSess) {
        Bun.spawnSync({ cmd: ['tmux', 'kill-session', '-t', tmuxSess] });
    }
});

describe('Squad Physical Simulation', () => {
    test('browser mounts the app shell with title Squad-Tau', async () => {
        await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForSelector('[data-app-title]', { timeout: 10000 });
        const title = await page.$eval('[data-app-title]', (el) => el.textContent);
        expect(title).toBe('Squad-Tau');
    }, 15000);

    test('HTTP /api/status returns 200 with correct fields', async () => {
        const resp = await fetch(`${uiUrl}/api/status`);
        expect(resp.status).toBe(200);
        const data = await resp.json();
        expect(data.status).toBe('ok');
        expect(typeof data.port).toBe('number');
    });

    test('HTTP /main.jsx returns 200 with JS content-type', async () => {
        const resp = await fetch(`${uiUrl}/main.jsx`);
        expect(resp.status).toBe(200);
        expect(resp.headers.get('content-type')).toMatch(/javascript/);
        const text = await resp.text();
        expect(text).toMatch(/createRoot/);
    });

    test('WS survives rapid reconnections (5×3 pongs)', async () => {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const counts = [];
        for (let i = 0; i < 5; i++) {
            try {
                counts.push((await wsPingPong(wsUrl, 3, 5000)).length);
            } catch {
                counts.push(0);
            }
        }
        expect(counts.every((c) => c >= 3)).toBe(true);
    }, 60000);

    test('concurrent HTTP + WS stress', async () => {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const httpResults = await Promise.all(
            Array.from({ length: 10 }, () =>
                fetch(`${uiUrl}/api/status`)
                    .then((r) => r.status)
                    .catch(() => 503),
            ),
        );
        const wsResults = await Promise.all(
            Array.from({ length: 3 }, () =>
                wsPingPong(wsUrl, 3, 8000)
                    .then((r) => r.length)
                    .catch(() => 0),
            ),
        );
        expect(httpResults.every((s) => s === 200)).toBe(true);
        expect(wsResults.every((c) => c >= 3)).toBe(true);
    }, 30000);

    test('WebSocket receives squad:init event', async () => {
        const msg = await awaitWsEvent(uiUrl.replace('http', 'ws') + '/ws', 'squad:init', 180000);
        expect(msg.payload).toBeDefined();
        expect(msg.payload.mode).toMatch(/^[ML]$/);
        expect(Array.isArray(msg.payload.nodes)).toBe(true);
    }, 200000);

    test('squad completes via WebSocket event and writes artifact', async () => {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const msg = await awaitWsEvent(wsUrl, 'squad:complete', 620000);

        // Algebraic assertion
        expect(Array.isArray(msg.payload.results)).toBe(true);
        expect(msg.payload.results.length).toBeGreaterThanOrEqual(1);
        expect(msg.payload.results.every((r) => r.nodeId)).toBe(true);

        // Physical assertion — non-polling, diskless until the final read
        const files = readdirSync(testDir).filter((f) => !f.startsWith('.') && f.endsWith('.js'));
        expect(files.length).toBeGreaterThanOrEqual(1);
        const content = readFileSync(path.join(testDir, files[0]), 'utf8');
        expect(content.length).toBeGreaterThan(100);
    }, 620000);
});
