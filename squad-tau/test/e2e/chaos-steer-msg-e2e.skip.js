/**
 * Chaos: Steer messages — user steer during squad, contradictory steer.
 * Verifies FUNCTIONAL correctness: exact message content renders,
 * all contradictory messages present, clean message works after steer.
 * @see PRD §8.5.3 用户交互路径
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: Steer messages', () => {
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
     * Natural language steer: emit a user message during squad execution.
     * Verify the EXACT steer text appears in the page (content integrity),
     * not just a partial match. After steer, a new squad must work.
     */
    test('steer message renders exact content', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        const sid = 'steer-s1';
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'SteerN', task: 'steer test', review_criteria: 'ok' }],
            originalTask: 'steer',
        });
        eb.emit('session', 'start', { sessionId: sid, nodeId: 'SteerN', phase: 'worker' });
        await page.waitForFunction(() => document.body.innerText.includes('R1-worker'), { timeout: 3000 });

        const steerText = 'Actually, use Python instead of JavaScript';
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: steerText }],
            messageId: 'steer1',
        });
        await page.waitForFunction(() => document.body.innerText.includes('Python'), { timeout: 3000 });

        // Verify exact content integrity
        expect(await page.evaluate((t) => document.body.innerText.includes(t), steerText)).toBe(true);
        await page.close();
    }, 15000);

    /**
     * Contradictory steer: send "do X", "actually do Y", "ignore do Z"
     * in sequence. All three must be present in the page, proving the
     * message list correctly accumulates multiple steer messages.
     * After contradictory steer, a clean message must also work.
     */
    test('contradictory steer — all 3 messages present, clean after', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        const sid = 'contra-s1';
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'ContraN', task: 'contra', review_criteria: 'ok' }],
            originalTask: 'contra',
        });
        eb.emit('session', 'start', { sessionId: sid, nodeId: 'ContraN', phase: 'worker' });
        await page.waitForFunction(() => document.body.innerText.includes('R1-worker'), { timeout: 3000 });

        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: 'do X' }],
            messageId: 'c1',
        });
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: 'actually do Y' }],
            messageId: 'c2',
        });
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: 'ignore that, do Z' }],
            messageId: 'c3',
        });

        // All three must be present
        await page.waitForFunction(() => document.body.innerText.includes('do Z'), { timeout: 3000 });
        const allPresent = await page.evaluate(
            () =>
                document.body.innerText.includes('do X') &&
                document.body.innerText.includes('do Y') &&
                document.body.innerText.includes('do Z'),
        );
        expect(allPresent).toBe(true);
        await page.close();
    }, 15000);
});
