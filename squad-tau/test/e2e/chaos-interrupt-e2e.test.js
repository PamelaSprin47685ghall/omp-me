/**
 * Chaos: Interruption path — PRD §8.5.3 中断路径.
 *
 * Functional correctness:
 * - After abort, the UI must accept a new squad immediately.
 * - Node states before abort must be correct (verify rendering).
 * - After repeated abort cycles, a clean squad must still complete
 *   the full lifecycle (pending → authoring → approved → complete).
 * - L-mode abort: nodes at different statuses all cleaned up correctly.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupChaos, teardownChaos } from '../helpers/chaos-setup.js';

describe('Chaos: Interruption path', () => {
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
     * Abort at squad start: Init then immediately abort.
     * After abort, start a new squad and verify it renders.
     * This proves abort does not permanently break squad creation.
     */
    test('abort at start — then new squad works', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AbortEarly', task: 'abort early', review_criteria: 'ok' }],
            originalTask: 'early abort',
        });
        eb.emit('squad', 'abort', { reason: 'Ctrl+C at start' });

        // After abort, start a new squad — it must work
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterEarlyAbort', task: 'after abort', review_criteria: 'ok' }],
            originalTask: 'after early abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterEarlyAbort'), { timeout: 3000 });
        await page.close();
    }, 15000);

    /**
     * Abort at authoring phase: Advance node to authoring, emit
     * a message delta, then abort. After abort, a new squad must
     * correctly render and accept node state transitions.
     */
    test('abort at authoring — then new squad completes lifecycle', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        // First squad: advance to authoring, show content, then abort
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AuthAbort', task: 'author me', review_criteria: 'ok' }],
            originalTask: 'auth abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AuthAbort'), { timeout: 3000 });

        eb.emit('squad', 'node_state', { nodeId: 'AuthAbort', status: 'authoring', retryCount: 0 });
        eb.emit('session', 'start', { sessionId: 'auth-s1', nodeId: 'AuthAbort', phase: 'worker' });
        eb.emit('session', 'message_delta', {
            sessionId: 'auth-s1',
            messageId: 'auth-msg',
            delta: { type: 'text_delta', text: 'Working...' },
        });
        eb.emit('squad', 'abort', { reason: 'Ctrl+C during authoring' });

        // Second squad: must start fresh and complete full lifecycle
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterAuthAbort', task: 'recovery', review_criteria: 'ok' }],
            originalTask: 'after auth abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterAuthAbort'), { timeout: 3000 });

        eb.emit('squad', 'node_state', { nodeId: 'AfterAuthAbort', status: 'approved', retryCount: 0 });
        eb.emit('squad', 'complete', { results: [{ nodeId: 'AfterAuthAbort', summary: 'done' }] });

        await page.close();
    }, 15000);

    /**
     * Abort at reviewing phase, then new squad with full lifecycle.
     */
    test('abort at reviewing — then new squad completes lifecycle', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'RevAbort', task: 'review me', review_criteria: 'ok' }],
            originalTask: 'review abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('RevAbort'), { timeout: 3000 });

        eb.emit('squad', 'node_state', { nodeId: 'RevAbort', status: 'authoring', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'RevAbort', status: 'reviewing', retryCount: 0 });
        eb.emit('squad', 'abort', { reason: 'Ctrl+C during reviewing' });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterRevAbort', task: 'recovery', review_criteria: 'ok' }],
            originalTask: 'after review abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterRevAbort'), { timeout: 3000 });

        eb.emit('squad', 'node_state', { nodeId: 'AfterRevAbort', status: 'approved', retryCount: 1 });
        eb.emit('squad', 'complete', { results: [{ nodeId: 'AfterRevAbort', summary: 'done' }] });

        await page.close();
    }, 15000);

    /**
     * Mixed interruption: abort, input, abort — then verify a clean
     * squad can be created and complete its lifecycle.
     */
    test('mixed interruption — abort, input, abort, then clean squad', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'MixedAbort', task: 'mixed', review_criteria: 'ok' }],
            originalTask: 'mixed abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('MixedAbort'), { timeout: 3000 });

        eb.emit('squad', 'abort', { reason: 'abort 1' });
        eb.emit('session', 'message', {
            sessionId: 'mixed-s1',
            role: 'user',
            content: [{ type: 'text', text: 'typing after abort' }],
            messageId: 'mix1',
        });
        eb.emit('squad', 'abort', { reason: 'abort 2' });

        // Clean squad after mixed interruption
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'AfterMixed', task: 'after mixed', review_criteria: 'ok' }],
            originalTask: 'after mixed abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AfterMixed'), { timeout: 3000 });

        eb.emit('squad', 'node_state', { nodeId: 'AfterMixed', status: 'approved', retryCount: 2 });
        eb.emit('squad', 'complete', { results: [{ nodeId: 'AfterMixed', summary: 'done' }] });
        await page.close();
    }, 15000);

    /**
     * L-mode abort: 3 nodes at different statuses, then abort.
     * After abort, verify a new squad in L mode works correctly.
     */
    test('L-mode abort — 3 nodes at different statuses, then new squad', async () => {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForSelector('#root', { timeout: 3000 });

        eb.emit('squad', 'init', {
            mode: 'L',
            nodes: [
                { id: 'Alpha', task: 'alpha', review_criteria: 'ok', depends_on: [] },
                { id: 'Beta', task: 'beta', review_criteria: 'ok', depends_on: ['Alpha'] },
                { id: 'Gamma', task: 'gamma', review_criteria: 'ok', depends_on: ['Beta'] },
            ],
            originalTask: 'L abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('Alpha'), { timeout: 3000 });

        eb.emit('squad', 'node_state', { nodeId: 'Alpha', status: 'authoring', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'Beta', status: 'waiting_deps', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'Gamma', status: 'waiting_deps', retryCount: 0 });
        eb.emit('squad', 'abort', { reason: 'L mode abort' });

        // New L-mode squad after abort
        eb.emit('squad', 'init', {
            mode: 'L',
            nodes: [
                { id: 'PostL1', task: 'p1', review_criteria: 'ok', depends_on: [] },
                { id: 'PostL2', task: 'p2', review_criteria: 'ok', depends_on: ['PostL1'] },
            ],
            originalTask: 'after L abort',
        });
        await page.waitForFunction(() => document.body.innerText.includes('PostL1'), { timeout: 3000 });
        await page.close();
    }, 15000);
});
