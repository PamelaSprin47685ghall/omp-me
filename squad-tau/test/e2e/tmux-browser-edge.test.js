/**
 * Edge case stress tests — aggressive bug hunting via synthetic events.
 *
 * Tests cover: out-of-order events, missing prerequisites, rapid fire,
 * invalid data, console errors, boundary conditions, concurrent streams.
 *
 * Reuses the same server/browser setup as tmux-browser.test.js.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser, waitForAppWebSocket } from '../helpers/puppeteer-setup.js';

async function waitForText(page, pattern, timeoutMs = 8000) {
    try {
        if (typeof pattern === 'string') {
            await page.waitForFunction((p) => document.body.textContent.includes(p), { timeout: timeoutMs }, pattern);
        } else {
            await page.waitForFunction((p) => p.test(document.body.textContent), { timeout: timeoutMs }, pattern);
        }
        return true;
    } catch {
        return false;
    }
}

function waitForSelector(page, selector, timeoutMs = 8000) {
    return page
        .waitForSelector(selector, { timeout: timeoutMs })
        .then(() => true)
        .catch(() => false);
}

describe('Edge Case Stress Tests', () => {
    let browser, port, eventBus;

    beforeAll(async () => {
        process.env.SQUAD_E2E = '1';
        const server = await startServer();
        port = server.port;
        eventBus = server.eventBus;
        const b = await setupBrowser();
        browser = b.browser;
    }, 60000);

    afterAll(async () => {
        await teardownBrowser(browser);
        await stopServer();
    });

    async function createPage() {
        const p = await browser.newPage();
        await p.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppWebSocket(p, 20000);
        return p;
    }

    function trackErrors(page) {
        const errors = [];
        const handler = (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        };
        page.on('console', handler);
        return { get: () => errors, stop: () => page.off('console', handler) };
    }

    function getRelevant(errs) {
        return errs.filter(
            (e) => !e.includes('favicon') && !e.includes('404 (Not Found)') && !e.includes('favicon.ico'),
        );
    }

    // ── 1. tool_result before tool_call ─────────────────────────────────────────

    test('tool_result before tool_call does not crash', async () => {
        const page = await createPage();
        try {
            const errs = trackErrors(page);
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1 worker', 5000);
            // Select session to view messages
            await page.evaluate(() => window.__selectLatestSession?.());

            eventBus.emit('session', 'tool_result', {
                sessionId: 's1',
                toolId: 'phantom-t1',
                result: { data: 'orphan' },
                isError: false,
            });
            eventBus.emit('session', 'tool_call', {
                sessionId: 's1',
                toolName: 'delayed_tool',
                toolId: 'phantom-t1',
                params: { task: 'test' },
            });

            expect(await waitForText(page, 'delayed_tool')).toBe(true);
            expect(getRelevant(errs.get()).length).toBe(0);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 2. message_delta to non-existent session ───────────────────────────────

    test('message to unknown session does not crash', async () => {
        const page = await createPage();
        try {
            const errs = trackErrors(page);
            eventBus.emit('session', 'message_delta', {
                sessionId: 'ghost',
                messageId: 'g1',
                delta: { type: 'text_delta', text: 'Ghost' },
            });
            await new Promise((r) => setTimeout(r, 1000));
            expect(await waitForText(page, 'Welcome to Squad-Tau')).toBe(true);
            expect(getRelevant(errs.get()).length).toBe(0);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 3. session:end without session:start ────────────────────────────────────

    test('session:end without start does not crash', async () => {
        const page = await createPage();
        try {
            const errs = trackErrors(page);
            eventBus.emit('session', 'end', { sessionId: 'orphan', reason: 'completed' });
            await new Promise((r) => setTimeout(r, 1000));
            expect(await waitForText(page, 'Welcome to Squad-Tau')).toBe(true);
            expect(getRelevant(errs.get()).length).toBe(0);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 4. Double squad:init ────────────────────────────────────────────────────

    test('second squad:init replaces first', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'first-plan', task: 'F', review_criteria: [] }],
                originalTask: 'f',
            });
            await waitForText(page, 'first-plan', 5000);
            eventBus.emit('squad', 'init', {
                mode: 'L',
                nodes: [
                    { id: 'repl-a', task: 'R', review_criteria: [] },
                    { id: 'repl-b', task: 'Rb', review_criteria: [] },
                ],
                originalTask: 's',
            });

            expect(await waitForText(page, 'repl-a')).toBe(true);
            expect(await waitForText(page, 'repl-b')).toBe(true);
            expect(await page.evaluate(() => !document.body.textContent.includes('first-plan'))).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 5. Empty nodes array ────────────────────────────────────────────────────

    test('squad:init with empty nodes shows DAG empty state', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', { mode: 'M', nodes: [], originalTask: 'empty' });
            expect(await waitForText(page, 'DAG Overview')).toBe(true);
            expect(await waitForText(page, 'No nodes in DAG')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 6. Rapid same toolId ────────────────────────────────────────────────────

    test('10 tool_calls with same toolId do not crash', async () => {
        const page = await createPage();
        try {
            const errs = trackErrors(page);
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1 worker', 5000);
            // Select session to view messages
            await page.evaluate(() => window.__selectLatestSession?.());

            for (let i = 0; i < 10; i++) {
                eventBus.emit('session', 'tool_call', {
                    sessionId: 's1',
                    toolName: 'rapid_tool',
                    toolId: 'dup-id',
                    params: { i },
                });
            }
            expect(await waitForText(page, 'rapid_tool')).toBe(true);
            expect(getRelevant(errs.get()).length).toBe(0);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 7. Very long text ───────────────────────────────────────────────────────

    test('10000 char text does not break layout', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1 worker', 5000);
            // Select session to view messages
            await page.evaluate(() => window.__selectLatestSession?.());
            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'long-msg',
                delta: { type: 'text_delta', text: 'A'.repeat(10000) },
            });
            expect(await waitForText(page, 'A'.repeat(100))).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 8. Negative retryCount ──────────────────────────────────────────────────

    test('negative retryCount does not crash sidebar', async () => {
        const page = await createPage();
        try {
            const errs = trackErrors(page);
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: -5 });
            expect(await waitForText(page, 'R')).toBe(true);
            // Select session to view messages
            await page.evaluate(() => window.__selectLatestSession?.());
            expect(await waitForSelector(page, 'textarea')).toBe(true);
            expect(getRelevant(errs.get()).length).toBe(0);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 9. 5 rapid session starts ───────────────────────────────────────────────

    test('5 rapid session starts all appear', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'root', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'root', 5000);
            for (let i = 0; i < 5; i++) {
                eventBus.emit('session', 'start', {
                    sessionId: `fast-${i}`,
                    nodeId: 'root',
                    phase: 'worker',
                    retryCount: i,
                });
            }
            // Sidebar shows labels as R{retryCount+1}-worker for each session
            for (let i = 1; i <= 5; i++) {
                expect(await waitForText(page, `R${i} worker`)).toBe(true);
            }
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 10. Empty session sidebar ───────────────────────────────────────────────

    test('sidebar renders Tree with no sessions', async () => {
        const page = await createPage();
        try {
            const errs = trackErrors(page);
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            expect(await page.evaluate(() => !!document.querySelector('.bp6-tree'))).toBe(true);
            expect(getRelevant(errs.get()).length).toBe(0);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 11. Deduplicate message by messageId ────────────────────────────────────

    test('same messageId replaces content without duplicate', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1 worker', 5000);
            // Select session to view messages
            await page.evaluate(() => window.__selectLatestSession?.());

            eventBus.emit('session', 'message', {
                sessionId: 's1',
                role: 'assistant',
                content: [{ type: 'text', text: 'Original' }],
                messageId: 'dedup',
            });
            expect(await waitForText(page, 'Original')).toBe(true);

            eventBus.emit('session', 'message', {
                sessionId: 's1',
                role: 'assistant',
                content: [{ type: 'text', text: 'Replaced' }],
                messageId: 'dedup',
            });
            expect(await waitForText(page, 'Replaced')).toBe(true);
            expect(await page.evaluate(() => !document.body.textContent.includes('Original'))).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 12. Full node state lifecycle ───────────────────────────────────────────

    test('pending → authoring → confirming → reviewing → approved', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'lifecycle', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'lifecycle', 5000);
            for (const status of ['pending', 'authoring', 'confirming', 'reviewing', 'approved']) {
                eventBus.emit('squad', 'node_state', { nodeId: 'lifecycle', status, retryCount: 0 });
            }
            expect(await waitForText(page, 'lifecycle')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 13. Interleaved deltas + tool_calls ─────────────────────────────────────

    test('interleaved events render all content', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1 worker', 5000);
            // Select session to view messages
            await page.evaluate(() => window.__selectLatestSession?.());

            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'a',
                delta: { type: 'thinking_delta', text: 'Thought' },
            });
            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'b',
                delta: { type: 'text_delta', text: 'Analysis' },
            });
            eventBus.emit('session', 'tool_call', {
                sessionId: 's1',
                toolName: 'search',
                toolId: 't1',
                params: { q: 'x' },
            });
            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'c',
                delta: { type: 'text_delta', text: 'Follow-up' },
            });
            eventBus.emit('session', 'tool_result', {
                sessionId: 's1',
                toolId: 't1',
                result: { ok: true },
                isError: false,
            });

            expect(await waitForText(page, 'Thought')).toBe(true);
            expect(await waitForText(page, 'Analysis')).toBe(true);
            expect(await waitForText(page, 'search')).toBe(true);
            expect(await waitForText(page, 'Follow-up')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 14. Two sessions independent streams ────────────────────────────────────

    test('concurrent sessions stream independently', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'L',
                nodes: [
                    { id: 'pa', task: 'A', review_criteria: [] },
                    { id: 'pb', task: 'B', review_criteria: [] },
                ],
                originalTask: 'p',
            });
            await waitForText(page, 'pa', 5000);
            eventBus.emit('session', 'start', { sessionId: 's-a', nodeId: 'pa', phase: 'worker', retryCount: 0 });
            eventBus.emit('session', 'start', { sessionId: 's-b', nodeId: 'pb', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1 worker', 5000);
            // Select session to view messages (session A)
            await page.evaluate(() => window.__selectLatestSession?.());

            eventBus.emit('session', 'message_delta', {
                sessionId: 's-a',
                messageId: 'ma',
                delta: { type: 'text_delta', text: 'A result' },
            });
            eventBus.emit('session', 'message_delta', {
                sessionId: 's-b',
                messageId: 'mb',
                delta: { type: 'text_delta', text: 'B result' },
            });

            expect(await waitForText(page, 'B result')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 15. Node_state for unknown node ─────────────────────────────────────────

    test('node_state for unknown nodeId does not crash', async () => {
        const page = await createPage();
        try {
            const errs = trackErrors(page);
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('squad', 'node_state', { nodeId: 'does-not-exist', status: 'approved', retryCount: 0 });
            await new Promise((r) => setTimeout(r, 1000));
            expect(await waitForText(page, 'Welcome to Squad-Tau')).toBe(false); // still in squad mode
            expect(getRelevant(errs.get()).length).toBe(0);
        } finally {
            await page.close();
        }
    }, 30000);
});
