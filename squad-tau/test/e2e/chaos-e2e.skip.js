/**
 * Chaos (monkey) E2E tests.
 * @see PRD/08-testing.md §8.5
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

describe('Chaos E2E', () => {
    let serverPort;
    let browser;
    let page;
    let pages = [];

    beforeAll(async () => {
        const result = await startServer();
        serverPort = result.port;
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
        pages.push(page);
        // Open a few more tabs
        for (let i = 0; i < 2; i++) {
            pages.push(await browser.newPage());
        }
        for (const p of pages) {
            await p.goto(`http://127.0.0.1:${serverPort}`);
        }
    });

    afterAll(async () => {
        await teardownBrowser(browser);
    });

    test('robustness under websocket and browser chaos', async () => {
        const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
        const chaosDuration = 10000; // 10 seconds
        const refreshInterval = 2000;
        const numClients = 5;

        let chaosActive = true;
        const clientPromises = [];

        // 1. Launch 5 WS clients simultaneously (direct WS)
        for (let i = 0; i < numClients; i++) {
            clientPromises.push(
                (async () => {
                    while (chaosActive) {
                        let ws;
                        try {
                            ws = new WebSocket(wsUrl);
                            await new Promise((resolve, reject) => {
                                ws.onopen = resolve;
                                ws.onerror = reject;
                                setTimeout(() => reject(new Error('timeout')), 1000);
                            });

                            // 2. Rapid random messages (malformed, malicious, random types)
                            const payloads = [
                                { type: 'ping' },
                                { type: 'unknown', data: 'junk' },
                                { payload: 'invalid' },
                                { type: 'model_pool:update', payload: { id: `chaos-${i}`, name: 'Random' } },
                                'not a json {',
                                '{}',
                                '',
                                'A'.repeat(1024 * 64), // 64KB string
                                JSON.stringify({ type: 'ping', extra: 'B'.repeat(1024) }),
                                { type: 'session:user_message', payload: { sessionId: 'nonexistent', text: 'chaos' } },
                            ];

                            for (let j = 0; j < 20 && chaosActive; j++) {
                                const p = payloads[Math.floor(Math.random() * payloads.length)];
                                const data = typeof p === 'string' ? p : JSON.stringify(p);
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(data);
                                }
                                await new Promise((r) => setTimeout(r, Math.random() * 50));
                            }
                        } catch (e) {
                            // Expected occasional failures during chaos
                        } finally {
                            if (ws) ws.close();
                        }
                        await new Promise((r) => setTimeout(r, Math.random() * 200));
                    }
                })(),
            );
        }

        // 3. Browser refreshes every 2 seconds for all tabs
        const refreshPromises = pages.map(async (p) => {
            while (chaosActive) {
                await new Promise((r) => setTimeout(r, refreshInterval + Math.random() * 500));
                if (!chaosActive) break;
                try {
                    await p.reload({ waitUntil: 'domcontentloaded' });
                } catch (e) {
                    // Ignore page errors during reload chaos
                }
            }
        });

        // Run chaos for specified duration
        await new Promise((r) => setTimeout(r, chaosDuration));
        chaosActive = false;

        // Wait for workers to wind down
        await Promise.allSettled([...clientPromises, ...refreshPromises]);

        // 4. Verify server is still healthy
        // Check HTTP status
        let healthy = false;
        let lastError = '';
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const resp = await fetch(`http://127.0.0.1:${serverPort}/api/status`);
                if (resp.status === 200) {
                    const text = await resp.text();
                    try {
                        const data = JSON.parse(text);
                        if (data.status === 'ok') {
                            healthy = true;
                            break;
                        }
                        lastError = 'Status not ok: ' + data.status;
                    } catch (e) {
                        lastError = 'JSON parse error: ' + text.substring(0, 100);
                    }
                } else {
                    lastError = 'HTTP ' + resp.status;
                    try {
                        const plain = await fetch(`http://127.0.0.1:${serverPort}/`);
                        lastError += '; / returned ' + plain.status;
                    } catch (e) {}
                }
            } catch (e) {
                lastError = e.message;
                await new Promise((r) => setTimeout(r, 1000));
            }
        }
        expect(healthy).toBe(true);

        // Check browser still loads (main page)
        await page.goto(`http://127.0.0.1:${serverPort}`, { waitUntil: 'networkidle0' });
        const bodyHandle = await page.$('body');
        expect(bodyHandle).not.toBeNull();

        // Check WS still connects
        const finalWs = new WebSocket(wsUrl);
        const connected = await new Promise((resolve) => {
            finalWs.onopen = () => {
                finalWs.close();
                resolve(true);
            };
            finalWs.onerror = () => resolve(false);
            setTimeout(() => resolve(false), 5000);
        });
        expect(connected).toBe(true);
    }, 120000); // 120s timeout as requested
});
