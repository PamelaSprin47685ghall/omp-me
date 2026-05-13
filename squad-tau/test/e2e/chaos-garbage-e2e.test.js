/**
 * Chaos: Garbage and mixed-language input — random ASCII, control characters,
 * very long nonsense, empty messages, CJK, Arabic, emoji overflow.
 * Verifies FUNCTIONAL correctness: page survives all variants and a clean
 * message works after each category of abuse.
 * @see PRD §8.5.3 用户交互路径
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: Garbage and mixed-language input', () => {
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
     * Garbage input: random ASCII noise, binary control characters,
     * very long nonsense (500 repetitions). After each variant, the
     * page must not crash. After all garbage, a clean message with
     * known content must render correctly — proving recovery.
     */
    test('garbage input — ASCII, binary, long nonsense, then clean message', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        const sid = 'garbage-s1';
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'GarbN', task: 'garbage', review_criteria: 'ok' }],
            originalTask: 'garbage',
        });
        eb.emit('session', 'start', { sessionId: sid, nodeId: 'GarbN', phase: 'worker' });
        await page.waitForFunction(() => document.body.innerText.includes('R1 worker'), { timeout: 3000 });

        // Random ASCII noise (all 128 values)
        const asciiNoise = String.fromCharCode(...Array.from({ length: 50 }, () => Math.floor(Math.random() * 128)));
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: asciiNoise }],
            messageId: 'g1',
        });

        // Binary control characters
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: '\x00\x01\x02\x03\x1b\x7f\x1f' }],
            messageId: 'g2',
        });

        // Very long nonsense
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: 'nonsense'.repeat(500) }],
            messageId: 'g3',
        });

        // After garbage: clean message must render
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: 'Clean message after garbage' }],
            messageId: 'g-clean',
        });
        await page.waitForFunction(() => document.body.innerText.includes('Clean message'), { timeout: 3000 });
        await page.close();
    }, 15000);

    /**
     * Mixed language: Chinese, Japanese, Arabic, and emoji overflow.
     * Verify each renders without corruption. After all language
     * variants, an English message must still work correctly.
     */
    test('mixed language — CJK, Arabic, emoji all render, English OK after', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        const sid = 'lang-s1';
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'LangN', task: 'lang', review_criteria: 'ok' }],
            originalTask: 'lang test',
        });
        eb.emit('session', 'start', { sessionId: sid, nodeId: 'LangN', phase: 'worker' });
        await page.waitForFunction(() => document.body.innerText.includes('R1 worker'), { timeout: 3000 });

        // Chinese
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: '中文测试消息' }],
            messageId: 'l1',
        });
        await page.waitForFunction(() => document.body.innerText.includes('中文'), { timeout: 3000 });

        // Japanese
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: '日本語のメッセージ' }],
            messageId: 'l2',
        });
        await page.waitForFunction(() => document.body.innerText.includes('日本語'), { timeout: 3000 });

        // Arabic
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: 'رسالة بالعربية' }],
            messageId: 'l3',
        });
        await page.waitForFunction(() => document.body.innerText.includes('رسالة'), { timeout: 3000 });

        // Emoji overflow
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: '😀🚀🔥💯🎉'.repeat(10) }],
            messageId: 'l4',
        });
        await page.waitForFunction(() => document.body.innerText.includes('😀'), { timeout: 3000 });

        // English after mixed language
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'user',
            content: [{ type: 'text', text: 'English OK after mixed lang' }],
            messageId: 'l-clean',
        });
        await page.waitForFunction(() => document.body.innerText.includes('English OK'), { timeout: 3000 });
        await page.close();
    }, 15000);
});
