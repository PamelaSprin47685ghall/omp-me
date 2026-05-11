/**
 * Chaos (monkey) E2E tests — zero sleep, fully event-driven.
 * @see PRD/08-testing.md §8.5
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer, getGlobalEventBus } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

const PAYLOADS = [
    { type: 'ping' },
    { type: 'unknown', data: 'junk' },
    'not a json {',
    '',
    'A'.repeat(1024 * 64),
    JSON.stringify({ type: 'ping', extra: 'B'.repeat(1024) }),
    { type: 'model_pool:update', payload: { action: 'add', slot: { provider: 'x', modelId: 'y', role: 'worker' } } },
    { type: 'session:user_message', payload: { sessionId: 'nonexistent', text: 'chaos' + 'x'.repeat(1024) } },
    { type: 'session:user_message', payload: { sessionId: '-1', text: '\0\x01\x02\x1f\u0000' } },
    JSON.stringify({}),
    JSON.stringify({ type: 'ping' }),
];

function wsConnect(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('ws timeout'));
        }, 3000);
        ws.onopen = () => {
            clearTimeout(timer);
            resolve(ws);
        };
        ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('ws error'));
        };
    });
}

function wsSendAll(ws, messages) {
    return new Promise((resolve) => {
        let idx = 0;
        const send = () => {
            while (idx < messages.length && ws.bufferedAmount === 0) {
                const p = messages[idx++];
                ws.send(typeof p === 'string' ? p : JSON.stringify(p));
            }
            if (idx >= messages.length) return resolve();
            ws.once('drain', send);
        };
        send();
    });
}

async function fireWsMessages(url, count) {
    const ws = await wsConnect(url);
    const msgs = Array.from({ length: count }, () => PAYLOADS[Math.floor(Math.random() * PAYLOADS.length)]);
    await wsSendAll(ws, msgs);
    ws.close();
}

async function healthCheck(baseUrl) {
    const resp = await fetch(`${baseUrl}/api/status`);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe('ok');
}

async function wsCheck(url) {
    const ws = await wsConnect(url);
    ws.close();
}

function collectN(n, createPromise) {
    let count = 0;
    const results = [];
    return new Promise((resolve) => {
        createPromise((result) => {
            results.push(result);
            count++;
            if (count >= n) resolve(results);
        });
    });
}

describe('Chaos E2E (event-driven)', () => {
    let port, browser, baseUrl, wsUrl;

    beforeAll(async () => {
        process.env.SQUAD_E2E = '1';
        const result = await startServer();
        port = result.port;
        baseUrl = `http://127.0.0.1:${port}`;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        const b = await setupBrowser();
        browser = b.browser;
    }, 20000);

    afterAll(async () => {
        if (browser) await teardownBrowser(browser);
        await stopServer();
    });

    test('survives websocket message abuse', async () => {
        const clients = Array.from({ length: 3 }, () => fireWsMessages(wsUrl, 30).catch(() => {}));
        await Promise.all(clients);
        await healthCheck(baseUrl);
        await wsCheck(wsUrl);
    }, 15000);

    test('survives browser refresh storms', async () => {
        const pages = await Promise.all([browser.newPage(), browser.newPage()]);
        const RELOADS_PER_PAGE = 5;

        const runner = async (page) => {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
            for (let i = 0; i < RELOADS_PER_PAGE; i++) {
                try {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }),
                        page.reload({ timeout: 5000 }),
                    ]);
                } catch {}
            }
        };

        await Promise.all(pages.map(runner));

        const check = await browser.newPage();
        await check.goto(baseUrl, { waitUntil: 'load', timeout: 10000 });
        await check.waitForSelector('#root', { timeout: 5000 });
        const text = await check.$eval('body', (el) => el.textContent);
        expect(text).toContain('Squad-Tau');
        await check.close();
        await Promise.all(pages.map((p) => p.close()));
        await healthCheck(baseUrl);
    }, 30000);

    test('events still process after chaos', async () => {
        const eb = getGlobalEventBus();
        const verified = new Promise((resolve) => eb.on('squad:chaos_verification', resolve));

        await Promise.all(Array.from({ length: 3 }, () => fireWsMessages(wsUrl, 15).catch(() => {})));

        eb.emit('squad', 'chaos_verification', { msg: 'after-chaos' });

        const result = await Promise.race([
            verified,
            new Promise((_, reject) => setTimeout(() => reject(new Error('event not received')), 5000)),
        ]);
        expect(result).toBeDefined();
        expect(result.msg).toBe('after-chaos');

        await healthCheck(baseUrl);
        await wsCheck(wsUrl);
    }, 15000);
});
