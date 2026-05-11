/**
 * Chaos E2E — PRD §8.5 attack surfaces.
 * Session storms, model pool CRUD under stress, abort, rapid mixed events.
 * Zero timer — all waits are event-driven (counter + promise).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer, getGlobalEventBus } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

function wsConnect(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error('ws error'));
    });
}

describe('Chaos E2E (PRD scenarios)', () => {
    let port, browser, baseUrl, wsUrl, eb;

    beforeAll(async () => {
        process.env.SQUAD_E2E = '1';
        const result = await startServer();
        port = result.port;
        baseUrl = `http://127.0.0.1:${port}`;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        eb = getGlobalEventBus();
        const b = await setupBrowser();
        browser = b.browser;
    }, 20000);

    afterAll(async () => {
        if (browser) await teardownBrowser(browser);
        await stopServer();
    });

    test('rapid session creation storm (resource exhaustion)', async () => {
        const N = 10;
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        // Create a squad so sidebar appears (needed for session display)
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'StormNode', task: 'storm', review_criteria: 'ok' }],
            originalTask: 'session storm',
        });

        // Fire N session starts rapidly
        for (let i = 0; i < N; i++) {
            eb.emit('session', 'start', { sessionId: `storm-${i}`, nodeId: 'StormNode', phase: 'worker' });
        }

        // Verify sessions rendered in sidebar
        await page.waitForFunction(() => document.body.innerText.includes('R1-worker'), { timeout: 5000 });

        // Server still healthy
        const resp = await fetch(`${baseUrl}/api/status`);
        expect(resp.status).toBe(200);
        await page.close();
    }, 15000);

    test('model pool CRUD under event stress', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        // Send model pool snapshot
        eb.emit('model_pool', 'snapshot', {
            slots: [
                { provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker', inUse: false },
                { provider: 'openai', modelId: 'gpt-4', role: 'reviewer', inUse: false },
            ],
        });

        // Fire other events simultaneously
        for (let i = 0; i < 5; i++) {
            eb.emit('session', 'start', { sessionId: `stress-${i}`, nodeId: `N${i}`, phase: 'worker' });
        }

        // Change pool state
        eb.emit('model_pool', 'changed', {
            slots: [
                { provider: 'anthropic', modelId: 'claude-sonnet', role: 'worker', inUse: false },
                { provider: 'deepseek', modelId: 'deepseek-coder', role: 'reviewer', inUse: false },
            ],
        });

        // Page still functional
        const text = await page.$eval('.brand-text', (el) => el.textContent);
        expect(text).toBe('Squad-Tau');
        await page.close();
    }, 15000);

    test('abort during squad execution', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'L',
            nodes: [
                { id: 'A', task: 'task A', review_criteria: 'ok', depends_on: [] },
                { id: 'B', task: 'task B', review_criteria: 'ok', depends_on: ['A'] },
            ],
            originalTask: 'abort test',
        });

        await page.waitForFunction(() => document.body.innerText.includes('A'), { timeout: 5000 });

        // Emit node states then abort
        eb.emit('squad', 'node_state', { nodeId: 'A', status: 'authoring', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'B', status: 'waiting_deps', retryCount: 0 });
        eb.emit('squad', 'abort', { reason: 'user cancelled' });

        await page.close();
    }, 15000);

    test('rapid mixed event types', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'Mix', task: 'x', review_criteria: 'y' }],
            originalTask: 'mix',
        });

        for (let i = 0; i < 8; i++) {
            eb.emit('session', 'start', { sessionId: `mix-${i}`, nodeId: 'Mix', phase: 'worker' });
            eb.emit('squad', 'node_state', {
                nodeId: 'Mix',
                status: i % 2 === 0 ? 'authoring' : 'reviewing',
                retryCount: i,
            });
            eb.emit('model_pool', 'changed', {
                slots: [{ provider: 'p', modelId: `m-${i}`, role: 'worker', inUse: false }],
            });
        }

        eb.emit('squad', 'complete', { results: [{ nodeId: 'Mix', summary: 'done' }] });

        // UI still functional
        const text = await page.$eval('.brand-text', (el) => el.textContent);
        expect(text).toBe('Squad-Tau');
        await fetch(`${baseUrl}/api/status`).then((r) => expect(r.status).toBe(200));
        await page.close();
    }, 15000);

    test('after-chaos: verify server recovers', async () => {
        const ws = await wsConnect(wsUrl);

        // Send ping messages, count pong responses
        const pongs = [];
        let resolvePongs;
        const pongPromise = new Promise((r) => {
            resolvePongs = r;
        });

        ws.addEventListener('message', (event) => {
            try {
                const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
                const msg = JSON.parse(text);
                if (msg.type === 'pong') {
                    pongs.push(msg);
                    if (pongs.length >= 5) resolvePongs();
                }
            } catch {}
        });

        for (let i = 0; i < 10; i++) ws.send(JSON.stringify({ type: 'ping' }));

        await pongPromise;
        expect(pongs.length).toBeGreaterThanOrEqual(5);
        ws.close();

        // Verify health
        const resp = await fetch(`${baseUrl}/api/status`);
        expect(resp.status).toBe(200);
    }, 15000);
});
