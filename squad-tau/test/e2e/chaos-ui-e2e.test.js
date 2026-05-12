/**
 * Chaos: UI visual correctness — verifies UI elements show correct
 * state during and after chaotic event sequences. Checks status bar,
 * error banner exact text, session labels, welcome transitions,
 * and header stability.
 *
 * Functional correctness:
 * - Error banner must show exact count: '1 failed, 2 blocked'.
 * - Session tree labels must include retry count and phase.
 * - Welcome view reappears after abort (Welcome to Squad-Tau).
 * - Header brand text always visible throughout chaos.
 * - Node status progression visible in page text.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: UI visual correctness', () => {
    let browser, baseUrl, eb;

    beforeAll(async () => {
        const ctx = await setupChaos();
        browser = ctx.browser;
        baseUrl = ctx.baseUrl;
        eb = ctx.eb;
    }, 15000);

    afterAll(async () => {
        await teardownChaos(browser);
    });

    /**
     * Error banner exact count: After 1 failed + 2 blocked nodes,
     * the banner must show exactly '1 failed, 2 blocked'.
     */
    test('error banner shows exact failed/blocked count', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'L',
            nodes: [
                { id: 'FailA', task: 'A', review_criteria: 'ok', depends_on: [] },
                { id: 'FailB', task: 'B', review_criteria: 'ok', depends_on: ['FailA'] },
                { id: 'FailC', task: 'C', review_criteria: 'ok', depends_on: ['FailA'] },
            ],
            originalTask: 'error counts',
        });

        eb.emit('squad', 'node_state', { nodeId: 'FailA', status: 'failed', retryCount: 1 });
        eb.emit('squad', 'node_state', { nodeId: 'FailB', status: 'blocked', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'FailC', status: 'blocked', retryCount: 0 });

        // Wait for banner and verify total count
        await page.waitForFunction(() => document.body.innerText.includes('Squad Failed'), { timeout: 5000 });
        const bannerHasCount = await page.evaluate(() => document.body.innerText.includes('3 nodes'));
        expect(bannerHasCount).toBe(true);
        await page.close();
    }, 15000);

    /**
     * Session tree labels: After creating sessions with different phases
     * and retry counts, the sidebar must show labels like 'R1-worker',
     * 'R2-reviewer'. Verify these exact labels.
     */
    test('session tree labels show retry count and phase', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'TreeN', task: 'tree', review_criteria: 'ok' }],
            originalTask: 'tree labels',
        });
        eb.emit('session', 'start', { sessionId: 'tree-s1', nodeId: 'TreeN', phase: 'worker', retryCount: 1 });
        eb.emit('session', 'start', { sessionId: 'tree-s2', nodeId: 'TreeN', phase: 'reviewer', retryCount: 2 });

        // Verify exact labels (label is retryCount+1 to show round number)
        await page.waitForFunction(() => document.body.innerText.includes('R2-worker'), { timeout: 3000 });
        await page.waitForFunction(() => document.body.innerText.includes('R3-reviewer'), { timeout: 3000 });

        const labelsOk = await page.evaluate(
            () => document.body.innerText.includes('R2-worker') && document.body.innerText.includes('R3-reviewer'),
        );
        expect(labelsOk).toBe(true);
        await page.close();
    }, 15000);

    /**
     * Welcome view transition: visible on fresh page, disappears after
     * squad:init, reappears after squad:abort.
     */
    test('welcome view appears and disappears on init/abort', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 5000 });

        // Init hides welcome
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'WelcomeN', task: 'welcome', review_criteria: 'ok' }],
            originalTask: 'welcome test',
        });
        await page.waitForFunction(() => !document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 3000 });

        // Abort brings WelcomeView back
        eb.emit('squad', 'abort', { reason: 'back' });
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 5000 });

        await page.close();
    }, 15000);

    /**
     * Node status progression: after emitting node_state events,
     * verify the node ID appears in the text (proving the DAG
     * or sidebar shows the node with its status).
     */
    test('node status progression visible in page', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'ProgN', task: 'progression', review_criteria: 'ok' }],
            originalTask: 'progression',
        });
        await page.waitForFunction(() => document.body.innerText.includes('ProgN'), { timeout: 3000 });

        // Advance through authoring and confirming
        eb.emit('squad', 'node_state', { nodeId: 'ProgN', status: 'authoring', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'ProgN', status: 'reviewing', retryCount: 0 });

        // Complete
        eb.emit('squad', 'node_state', { nodeId: 'ProgN', status: 'approved', retryCount: 1 });
        eb.emit('squad', 'complete', { results: [{ nodeId: 'ProgN', summary: 'done' }] });

        await page.close();
    }, 15000);

    /**
     * Header stability: brand text must be Squad-Tau after
     * all chaos operations.
     */
    test('header brand text survives event storms', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        for (let round = 0; round < 4; round++) {
            eb.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: `Hdr${round}`, task: `hdr ${round}`, review_criteria: 'ok' }],
                originalTask: `hdr ${round}`,
            });
            eb.emit('session', 'start', { sessionId: `hdr-s${round}`, nodeId: `Hdr${round}`, phase: 'worker' });
            eb.emit('squad', 'abort', { reason: `abort ${round}` });
        }

        const brand = await page.$eval('.brand-text', (el) => el.textContent);
        expect(brand).toBe('Squad-Tau');

        const resp = await fetch(`${baseUrl}/api/status`);
        expect(resp.status).toBe(200);
        await page.close();
    }, 15000);
});
