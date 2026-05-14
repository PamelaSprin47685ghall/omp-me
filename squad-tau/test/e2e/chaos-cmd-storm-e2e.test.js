/**
 * Chaos: Command rapid operations — rapid mode switching, /new storm, /compact abuse.
 * Verifies FUNCTIONAL correctness: squad after storms, sessions after cycles.
 * @see PRD §8.5.3 命令路径
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: Command rapid operations', () => {
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
     * Rapid mode switching: 5 init events in alternating M/L sequence,
     * then verify the last init's node renders and a clean squad works.
     */
    test('rapid mode switching — last init renders, clean squad after', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        for (let i = 0; i < 5; i++) {
            eb.emit('squad', 'init', {
                mode: i % 2 === 0 ? 'M' : 'L',
                nodes: [{ id: `Ms${i}`, task: `mode ${i}`, review_criteria: 'ok', depends_on: [] }],
                originalTask: `rapid ${i}`,
            });
        }
        // Last init must render
        await page.waitForFunction(() => document.body.innerText.includes('Ms4'), { timeout: 5000 });

        // Clean squad after switching storm
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterRapid', task: 'after rapid', review_criteria: 'ok' }],
            originalTask: 'after rapid',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterRapid'), { timeout: 3000 });
        await page.close();
    }, 15000);

    /**
     * /new storm: 20 rapid session create/destroy cycles while squad is active.
     * After the storm, start a new session with a message and verify the
     * content renders, proving the session system still functions.
     */
    test('/new storm — 20 cycles, then new session with message works', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'StormN', task: 'base', review_criteria: 'ok' }],
            originalTask: 'storm',
        });
        await page.waitForFunction(() => document.body.innerText.includes('StormN'), { timeout: 3000 });

        for (let i = 0; i < 20; i++) {
            eb.emit('session', 'start', { sessionId: `st-${i}`, nodeId: 'StormN', phase: 'worker' });
            eb.emit('session', 'end', { sessionId: `st-${i}`, reason: 'aborted' });
        }

        // Wait for all storm sessions to render in sidebar
        await page.waitForFunction(
            () => {
                const items = [...document.querySelectorAll('[role="treeitem"]')];
                const workers = items.filter((el) => (el.textContent || '').trim() === 'R1 worker');
                return workers.length >= 20;
            },
            { timeout: 5000 },
        );

        // Click the last R1 worker to select the final storm session
        await page.evaluate(() => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const workers = items.filter((el) => (el.textContent || '').trim() === 'R1 worker');
            const last = workers[workers.length - 1];
            if (last) last.click();
        });
        // Confirm session view is active: 'No messages yet' appears
        await page.waitForFunction(() => document.body.innerText.includes('No messages yet'), { timeout: 5000 });

        // Emit a message for the selected session (st-19 is the last by insertion order)
        eb.emit('session', 'message', {
            sessionId: 'st-19',
            role: 'assistant',
            content: [{ type: 'text', text: 'After storm message' }],
            messageId: 'storm-msg',
        });
        // Manual polling to avoid puppeteer timeout discrepancies
        await page.waitForFunction(() => document.body.innerText.includes('After storm'), { timeout: 5000 });

        // New squad after storm
        await page.evaluate(() => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const dagNode = items.find((el) => (el.textContent || '').includes('DAG Overview'));
            if (dagNode) dagNode.click();
        });
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'PostStorm', task: 'post-storm', review_criteria: 'ok' }],
            originalTask: 'post storm',
        });
        await page.waitForFunction(() => document.body.innerText.includes('PostStorm'), { timeout: 3000 });
        await page.close();
    }, 15000);

    /**
     * /compact abuse: Complete the squad immediately after starting it,
     * while simultaneously firing session events. After the compact,
     * start a new squad and verify it renders correctly.
     */
    test('/compact abuse — new squad after immediate complete', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });
        await page.waitForFunction(() => window.__wsConnected, { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'CompactN', task: 'compact', review_criteria: 'ok' }],
            originalTask: 'compact',
        });
        for (let i = 0; i < 5; i++) {
            eb.emit('session', 'start', { sessionId: `cp-${i}`, nodeId: 'CompactN', phase: 'worker' });
        }
        eb.emit('squad', 'complete', { results: [{ nodeId: 'CompactN', summary: 'done' }] });

        // New squad after compact
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'PostCompact', task: 'after compact', review_criteria: 'ok' }],
            originalTask: 'after compact',
        });
        await page.waitForFunction(() => document.body.innerText.includes('PostCompact'), { timeout: 3000 });
        await page.close();
    }, 15000);
});
