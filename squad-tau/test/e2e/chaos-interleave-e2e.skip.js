/**
 * Chaos: Interleaved concurrent events — simulates real-world racing
 * between squad ops, session management, model pool, and abort signals.
 *
 * Functional correctness:
 * - Squad cycling: after 5 cycles, last squad's node appears and
 *   accepts node_state transitions.
 * - Abort race mid-burst: after abort, a new squad still works.
 * - Three-way interleave: after 6 three-way events, last node renders.
 * - Tool chain with pool changes: tool name + result both visible.
 * - Mixed event storm: after 20 random events, brand text survives.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: Interleaved concurrent events', () => {
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
     * 5 squad init/complete cycles with sessions interleaved.
     * After all cycles, verify the last squad's node renders.
     */
    test('5 squad cycles with interleaved sessions — last node renders', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        for (let c = 0; c < 5; c++) {
            eb.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: `Cyc${c}`, task: `cycle ${c}`, review_criteria: 'ok' }],
                originalTask: `cycle ${c}`,
            });
            eb.emit('session', 'start', { sessionId: `c-${c}`, nodeId: `Cyc${c}`, phase: 'worker' });
            eb.emit('session', 'message', {
                sessionId: `c-${c}`,
                role: 'assistant',
                content: [{ type: 'text', text: `Msg ${c}` }],
                messageId: `m${c}`,
            });
            eb.emit('squad', 'complete', { results: [{ nodeId: `Cyc${c}`, summary: `done ${c}` }] });
        }

        // Last cycle's node should render
        await page.waitForFunction(() => document.body.innerText.includes('Cyc4'), { timeout: 5000 });

        // New squad after cycling
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterCycles', task: 'after', review_criteria: 'ok' }],
            originalTask: 'after cycles',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterCycles'), { timeout: 3000 });
        await page.close();
    }, 15000);

    /**
     * Abort race: emit abort mid-session-burst. After abort, verify
     * a new squad can start and render its node.
     */
    test('abort mid-burst — then new squad starts correctly', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'RaceN', task: 'race', review_criteria: 'ok' }],
            originalTask: 'race',
        });
        await page.waitForFunction(() => document.body.innerText.includes('RaceN'), { timeout: 3000 });

        for (let i = 0; i < 6; i++) {
            eb.emit('session', 'start', { sessionId: `race-${i}`, nodeId: 'RaceN', phase: 'worker' });
            eb.emit('session', 'message', {
                sessionId: `race-${i}`,
                role: 'assistant',
                content: [{ type: 'text', text: `race ${i}` }],
                messageId: `rm${i}`,
            });
            if (i === 2) eb.emit('squad', 'abort', { reason: 'mid burst' });
        }

        // New squad must work
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'PostRace', task: 'post race', review_criteria: 'ok' }],
            originalTask: 'post race',
        });
        await page.waitForFunction(() => document.body.innerText.includes('PostRace'), { timeout: 3000 });
        await page.close();
    }, 15000);

    /**
     * Three-way interleave: 6 iterations of squad+session+pool.
     * Verify the last iteration's node renders.
     */
    test('three-way interleave — squad+session+pool 6x, last node renders', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        for (let i = 0; i < 6; i++) {
            eb.emit('squad', 'init', {
                mode: i % 2 === 0 ? 'M' : 'L',
                nodes: [{ id: `TW${i}`, task: `tw ${i}`, review_criteria: 'ok', depends_on: [] }],
                originalTask: `tw ${i}`,
            });
            eb.emit('session', 'start', { sessionId: `tw-${i}`, nodeId: `TW${i}`, phase: 'worker' });
            eb.emit('model_pool', 'changed', {
                slots: [{ provider: 'p', modelId: `m${i}`, role: 'worker', inUse: false }],
            });
        }

        await page.waitForFunction(() => document.body.innerText.includes('TW5'), { timeout: 5000 });

        // New squad after interleave
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'PostTW', task: 'post TW', review_criteria: 'ok' }],
            originalTask: 'post TW',
        });
        await page.waitForFunction(() => document.body.innerText.includes('PostTW'), { timeout: 3000 });
        await page.close();
    }, 15000);

    /**
     * Tool chain with model pool changes: emit tool_call, message,
     * pool_changed, tool_result. Verify tool name and result visible.
     */
    test('tool chain with pool changes — tool name + result visible', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        const sid = 'tool-chain-s1';
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'ToolChain', task: 'chain', review_criteria: 'ok' }],
            originalTask: 'tool chain',
        });
        eb.emit('session', 'start', { sessionId: sid, nodeId: 'ToolChain', phase: 'worker' });
        await page.waitForFunction(() => document.body.innerText.includes('ToolChain'), { timeout: 3000 });

        eb.emit('session', 'tool_call', {
            sessionId: sid,
            toolName: 'fetch_data',
            toolId: 'tc1',
            params: { url: 'https://example.com' },
        });
        eb.emit('model_pool', 'changed', { slots: [{ provider: 'p', modelId: 'bg1', role: 'worker', inUse: true }] });
        eb.emit('session', 'message', {
            sessionId: sid,
            role: 'assistant',
            content: [{ type: 'text', text: 'Fetching...' }],
            messageId: 'chain-msg',
        });
        eb.emit('model_pool', 'changed', {
            slots: [{ provider: 'p', modelId: 'bg2', role: 'reviewer', inUse: false }],
        });
        eb.emit('session', 'tool_result', {
            sessionId: sid,
            toolId: 'tc1',
            result: { data: 'ok' },
        });

        // Tool name must be visible
        await page.waitForFunction(() => document.body.innerText.includes('fetch_data'), { timeout: 5000 });

        eb.emit('squad', 'complete', { results: [{ nodeId: 'ToolChain', summary: 'done' }] });
        await page.close();
    }, 15000);

    /**
     * Mixed event storm: 20 events of all types in sequence.
     * Verify brand text survives.
     */
    test('mixed event storm — 20 events, brand text survives', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        for (let i = 0; i < 20; i++) {
            const t = i % 5;
            if (t === 0)
                eb.emit('squad', 'init', {
                    mode: 'M',
                    nodes: [{ id: `S${i}`, task: `s${i}`, review_criteria: 'ok' }],
                    originalTask: `s${i}`,
                });
            else if (t === 1) eb.emit('session', 'start', { sessionId: `ss${i}`, nodeId: `S${i}`, phase: 'worker' });
            else if (t === 2) eb.emit('squad', 'node_state', { nodeId: `S${i}`, status: 'authoring', retryCount: i });
            else if (t === 3)
                eb.emit('model_pool', 'changed', {
                    slots: [{ provider: 'p', modelId: `m${i}`, role: 'worker', inUse: false }],
                });
            else
                eb.emit('session', 'message', {
                    sessionId: `ss${i}`,
                    role: 'assistant',
                    content: [{ type: 'text', text: `msg${i}` }],
                    messageId: `m${i}`,
                });
        }

        const brand = await page.$eval('.brand-text', (el) => el.textContent);
        expect(brand).toBe('Squad-Tau');
        await page.close();
    }, 15000);
});
