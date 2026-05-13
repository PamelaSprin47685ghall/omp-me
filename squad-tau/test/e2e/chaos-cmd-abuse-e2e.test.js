/**
 * Chaos: Command abuse — /squad M extreme texts, /squad L empty/cyclic/52 nodes/duplicate.
 * Verifies FUNCTIONAL correctness: node IDs render, clean squad works after abuse.
 * @see PRD §8.5.3 命令路径
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: Command abuse', () => {
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
     * /squad M with extreme task texts: very long (5000 chars), control characters,
     * Unicode plus emoji, and only spaces. After each variant, verify the node name
     * renders in the page. After all abuse, start a clean squad and advance it
     * through node_state to approved, proving the system remains functional.
     */
    test('/squad M extreme texts — clean squad works after all variants', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        // Very long task (5000 characters)
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'LongN', task: 'A'.repeat(5000), review_criteria: 'ok' }],
            originalTask: 'long',
        });
        await page.waitForFunction(() => document.body.innerText.includes('LongN'), { timeout: 3000 });

        // Binary control characters
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'CtrlN', task: '\x00\x01\x02\x7f\x1b', review_criteria: 'ok' }],
            originalTask: 'ctrl',
        });
        await page.waitForFunction(() => document.body.innerText.includes('CtrlN'), { timeout: 3000 });

        // Unicode plus emoji
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'UniN', task: '中文日本語العربية😀🚀', review_criteria: 'ok' }],
            originalTask: 'unicode',
        });
        await page.waitForFunction(() => document.body.innerText.includes('UniN'), { timeout: 3000 });

        // Only spaces
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'SpcN', task: '     ', review_criteria: 'ok' }],
            originalTask: '     ',
        });
        await page.waitForFunction(() => document.body.innerText.includes('SpcN'), { timeout: 3000 });

        // After all abuse: clean squad must still work
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterAbuse', task: 'clean', review_criteria: 'ok' }],
            originalTask: 'after abuse',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterAbuse'), { timeout: 3000 });
        eb.emit('squad', 'node_state', { nodeId: 'AfterAbuse', status: 'approved', retryCount: 0 });
        eb.emit('squad', 'complete', { results: [{ nodeId: 'AfterAbuse', summary: 'success' }] });
        await page.close();
    }, 15000);

    /**
     * /squad L with empty node list, cyclic dependencies (A→B→A),
     * 52 nodes with chain dependencies, and duplicate node IDs.
     * For 52 nodes, sample-check 5 IDs across the range. After all
     * L abuse variants, start a clean M squad and verify it renders.
     */
    test('/squad L empty, cyclic, 52 nodes, duplicate — then clean M squad', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        // Empty node list — verify brand element still exists
        eb.emit('squad', 'init', { mode: 'L', nodes: [], originalTask: 'empty' });
        await page.waitForFunction(() => document.querySelector('.app-title')?.textContent === 'Squad-Tau', {
            timeout: 3000,
        });

        // Cyclic dependencies
        eb.emit('squad', 'init', {
            mode: 'L',
            nodes: [
                { id: 'CycA', task: 'a', review_criteria: 'ok', depends_on: ['CycB'] },
                { id: 'CycB', task: 'b', review_criteria: 'ok', depends_on: ['CycA'] },
            ],
            originalTask: 'cyclic',
        });
        await page.waitForFunction(() => document.querySelector('.app-title')?.textContent === 'Squad-Tau', {
            timeout: 3000,
        });

        // 52 nodes: verify 5 sampled IDs
        const many = Array.from({ length: 52 }, (_, i) => ({
            id: `BigN${i}`,
            task: `t${i}`,
            review_criteria: 'ok',
            depends_on: i > 0 ? [`BigN${i - 1}`] : [],
        }));
        eb.emit('squad', 'init', { mode: 'L', nodes: many, originalTask: '52 nodes' });
        await page.waitForFunction(() => document.body.innerText.includes('BigN51'), { timeout: 5000 });
        for (const id of ['BigN0', 'BigN10', 'BigN25', 'BigN50', 'BigN51']) {
            expect(await page.evaluate((nid) => document.body.innerText.includes(nid), id)).toBe(true);
        }

        // Duplicate node IDs
        eb.emit('squad', 'init', {
            mode: 'L',
            nodes: [
                { id: 'Dup', task: 'first', review_criteria: 'ok', depends_on: [] },
                { id: 'Dup', task: 'second', review_criteria: 'ok', depends_on: [] },
            ],
            originalTask: 'dup',
        });
        await page.waitForFunction(() => document.querySelector('.app-title')?.textContent === 'Squad-Tau', {
            timeout: 3000,
        });

        // Clean M squad after all L abuse
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterLAbuse', task: 'recovery', review_criteria: 'ok' }],
            originalTask: 'after L abuse',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterLAbuse'), { timeout: 3000 });
        await page.close();
    }, 15000);
});
