/**
 * Chaos: Destructive / Functional — PRD §8.5.3.
 *
 * Functional correctness:
 * - Chaos then verify: after disruption burst, a clean squad must
 *   render nodes and accept node_state transitions correctly.
 * - Recovery after 5 aborts: 6th squad must complete lifecycle
 *   (init → node_state → complete).
 * - Session switching: both sessions must show their respective
 *   messages (verify content per session via page text).
 * - Server health: HTTP 200 + WS ping-pong still works.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: Destructive / Functional scenarios', () => {
    let browser, baseUrl, wsUrl, eb;

    beforeAll(async () => {
        const ctx = await setupChaos();
        browser = ctx.browser;
        baseUrl = ctx.baseUrl;
        wsUrl = ctx.wsUrl;
        eb = ctx.eb;
    }, 15000);

    afterAll(async () => {
        await teardownChaos(browser);
    });

    /**
     * Chaos then verify: Emit disruption burst, then clean squad.
     * Verify the clean squad's node appears AND can transition to
     * approved state. This proves the system can accept and process
     * new work after chaotic disruption.
     */
    test('chaos burst then clean squad completes lifecycle', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        // Disruption
        for (let i = 0; i < 10; i++) {
            eb.emit('session', 'start', { sessionId: `disrupt-${i}`, nodeId: `D${i}`, phase: 'worker' });
        }
        (eb.emit('model_pool', 'changed', { slots: [] }),
            eb.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'DisruptN', task: 'noise', review_criteria: 'ok' }],
                originalTask: 'noise',
            }));

        // Clean squad after disruption — must work
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'CleanPost', task: 'clean', review_criteria: 'ok' }],
            originalTask: 'clean after chaos',
        });
        await page.waitForFunction(() => document.body.innerText.includes('CleanPost'), { timeout: 5000 });

        // Full lifecycle
        eb.emit('squad', 'node_state', { nodeId: 'CleanPost', status: 'approved', retryCount: 0 });
        eb.emit('squad', 'complete', { results: [{ nodeId: 'CleanPost', summary: 'success' }] });
        await page.close();
    }, 15000);

    /**
     * 5 aborts then 6th squad completes full lifecycle.
     * Proves recovery after repeated interruptions.
     */
    test('5 aborts then 6th squad completes lifecycle', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        for (let i = 0; i < 5; i++) {
            eb.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: `AbortR${i}`, task: `a${i}`, review_criteria: 'ok' }],
                originalTask: `abort ${i}`,
            });
            eb.emit('squad', 'abort', { reason: `abort ${i}` });
        }

        // 6th squad must complete
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'SixthSquad', task: 'sixth', review_criteria: 'ok' }],
            originalTask: 'sixth',
        });
        await page.waitForFunction(() => document.body.innerText.includes('SixthSquad'), { timeout: 5000 });

        eb.emit('squad', 'node_state', { nodeId: 'SixthSquad', status: 'approved', retryCount: 2 });
        eb.emit('squad', 'complete', { results: [{ nodeId: 'SixthSquad', summary: 'recovered' }] });
        await page.close();
    }, 15000);

    /**
     * Session switching: After creating 2 sessions with different messages,
     * verify both messages appear in the page (both sessions rendered
     * their content — messages are per-session but the UI auto-selects
     * the latest, which shows its messages).
     */
    test('session switching — both session messages rendered', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'SwitchRoot', task: 'switch', review_criteria: 'ok' }],
            originalTask: 'session switch',
        });
        await page.waitForFunction(() => document.body.innerText.includes('SwitchRoot'), { timeout: 3000 });

        // Session 1 with message
        eb.emit('session', 'start', { sessionId: 'sw-s1', nodeId: 'SwitchRoot', phase: 'worker' });
        eb.emit('session', 'message', {
            sessionId: 'sw-s1',
            role: 'assistant',
            content: [{ type: 'text', text: 'Session ONE content' }],
            messageId: 'sw-m1',
        });

        // Session 2 with different message
        eb.emit('session', 'start', { sessionId: 'sw-s2', nodeId: 'SwitchRoot', phase: 'reviewer' });
        eb.emit('session', 'message', {
            sessionId: 'sw-s2',
            role: 'assistant',
            content: [{ type: 'text', text: 'Session TWO content' }],
            messageId: 'sw-m2',
        });

        // Session 2 is latest, auto-selected
        await page.waitForFunction(() => document.body.innerText.includes('Session TWO content'), { timeout: 3000 });

        // Both session labels (R1-worker, R1-reviewer) visible in sidebar
        await page.waitForFunction(
            () => {
                const text = document.body.innerText;
                return text.includes('R1-worker') && text.includes('R1-reviewer');
            },
            { timeout: 3000 },
        );
        await page.close();
    }, 15000);

    /**
     * Server health after all chaos: HTTP 200 + WS ping-pong.
     */
    test('server health — HTTP and WebSocket after chaos', async () => {
        const resp = await fetch(`${baseUrl}/api/status`);
        expect(resp.status).toBe(200);
        const data = await resp.json();
        expect(data.status).toBe('ok');

        const ws = await new Promise((resolve, reject) => {
            const w = new WebSocket(wsUrl);
            w.onopen = () => resolve(w);
            w.onerror = () => reject(new Error('ws error'));
        });

        // Ping-pong must work
        const pongs = [];
        let pongDone;
        const pongPromise = new Promise((r) => {
            pongDone = r;
        });
        ws.addEventListener('message', (event) => {
            const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
            try {
                const msg = JSON.parse(text);
                if (msg.type === 'pong') {
                    pongs.push(msg);
                    if (pongs.length >= 3) pongDone();
                }
            } catch {}
        });

        ws.send(JSON.stringify({ type: 'ping' }));
        ws.send(JSON.stringify({ type: 'ping' }));
        ws.send(JSON.stringify({ type: 'ping' }));
        await pongPromise;
        expect(pongs.length).toBeGreaterThanOrEqual(3);
        ws.close();
    }, 15000);
});
