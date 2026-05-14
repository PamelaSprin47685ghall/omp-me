#!/usr/bin/env bun
/**
 * Physical real-environment simulation (standalone).
 *
 * Start OMP in tmux → send /squad → poll for UI URL → run baseline + chaos tests.
 * Usage:  SQUAD_MODEL=p-openai/gpt-5.2 ./simulation/squad-physical.js
 *
 * This is NOT a bun:test file — run it directly:
 *   bun run simulation/squad-physical.js
 */
import path from 'path';
import { setupBrowser, teardownBrowser } from './test/helpers/puppeteer-setup.js';

let passed = 0;
let failed = 0;

function assert(ok, label) {
    if (ok) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        console.error(`  ✗ ${label}`);
    }
}

async function assertThrows(fn, label) {
    try {
        await fn();
        failed++;
        console.error(`  ✗ ${label} (expected throw)`);
    } catch {
        passed++;
        console.log(`  ✓ ${label}`);
    }
}

function assertEqual(actual, expected, label) {
    const ok = actual === expected || (Number.isNaN(actual) && Number.isNaN(expected));
    if (ok) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        console.error(`  ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertMatch(str, re, label) {
    if (re.test(str)) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        console.error(`  ✗ ${label} — ${JSON.stringify(str)} does not match ${re}`);
    }
}

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

async function main() {
    let tmuxSess, testDir, uiUrl, browser, page;

    console.log('\n=== Squad-Tau Physical Simulation ===\n');

    // ── Setup ──────────────────────────────────────────────
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

    try {
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
    } catch (err) {
        console.error('[setup] failed:', err.message);
        cleanup();
        process.exit(1);
    }

    // ── BASELINE ──────────────────────────────────────────
    console.log('\n--- Baseline ---');

    try {
        await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForSelector('[data-app-title]', { timeout: 10000 });
        const title = await page.$eval('[data-app-title]', (el) => el.textContent);
        assert(title === 'Squad-Tau', 'browser mounts the app shell with title Squad-Tau');
    } catch (err) {
        assert(false, `browser mounts the app shell: ${err.message}`);
    }

    try {
        const resp = await fetch(`${uiUrl}/api/status`);
        assertEqual(resp.status, 200, 'HTTP /api/status returns 200');
        const data = await resp.json();
        assertEqual(data.status, 'ok', 'status field is "ok"');
        assert(typeof data.port === 'number', 'port is a number');
    } catch (err) {
        assert(false, `HTTP /api/status: ${err.message}`);
    }

    try {
        const resp = await fetch(`${uiUrl}/main.jsx`);
        assertEqual(resp.status, 200, 'HTTP /main.jsx returns 200');
        assert(resp.headers.get('content-type').includes('javascript'), 'content-type includes javascript');
        const text = await resp.text();
        assert(text.includes('createRoot'), 'response contains createRoot');
    } catch (err) {
        assert(false, `HTTP /main.jsx: ${err.message}`);
    }

    // ── CHAOS / STRESS ────────────────────────────────────
    console.log('\n--- Chaos / Stress ---');

    try {
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
        assert(
            counts.every((c) => c >= 3),
            'WS survives rapid reconnections (5×3 pongs)',
        );
    } catch (err) {
        assert(false, `WS reconnect: ${err.message}`);
    }

    try {
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
        const httpStatuses = await Promise.all(httpStorm);
        const wsLengths = await Promise.all(wsStorm);
        assert(
            httpStatuses.every((s) => s === 200),
            'concurrent HTTP + WS: all 10 HTTP requests return 200',
        );
        assert(
            wsLengths.every((c) => c >= 3),
            'concurrent HTTP + WS: all 3 WS sessions get 3 pongs',
        );
    } catch (err) {
        assert(false, `concurrent stress: ${err.message}`);
    }

    // ── SQUAD PROGRESS ────────────────────────────────────
    console.log('\n--- Squad Progress ---');

    try {
        const wsUrl = uiUrl.replace('http', 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const init = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('init timeout'));
            }, 180000);
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
        console.log('[test] got squad:init, mode:', init.payload.mode, 'nodes:', init.payload.nodes.length);
        assert(init.payload && init.payload.mode, 'squad:init payload has mode');
        assertMatch(init.payload.mode, /^[ML]$/, 'mode is M or L');
        assert(Array.isArray(init.payload.nodes), 'nodes is an array');
    } catch (err) {
        assert(false, `WebSocket receives squad init: ${err.message}`);
    }

    try {
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
        assert(marker.completedAt > 0, 'completedAt is positive');
        assert(marker.durationMs > 0, 'durationMs is positive');
        assert(marker.nodes >= 1, 'at least 1 node completed');
    } catch (err) {
        assert(false, `squad completion marker: ${err.message}`);
    }

    // ── Result ────────────────────────────────────────────
    cleanup();

    console.log(`\n--- Result: ${passed} passed, ${failed} failed ---\n`);
    process.exit(failed > 0 ? 1 : 0);
}

function cleanup() {
    if (browser) teardownBrowser(browser).catch(() => {});
    try {
        Bun.spawnSync({ cmd: ['tmux', 'kill-session', '-t', tmuxSess] });
    } catch {}
}

main().catch((err) => {
    console.error('Fatal:', err);
    cleanup();
    process.exit(1);
});
