/**
 * Standalone E2E — complex PRD scenarios.
 * Covers session tree, error banner, streaming, tool calls, welcome transition.
 * @see PRD/08-testing.md §8.4, PRD/05-event-protocol.md
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, getGlobalEventBus } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

const NAV = { waitUntil: 'domcontentloaded', timeout: 8000 };

describe('Standalone E2E', () => {
    let browser, page, port, eb;

    beforeAll(async () => {
        process.env.SQUAD_E2E = 'true';
        const result = await startServer();
        port = result.port;
        eb = getGlobalEventBus();
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
        await page.goto(`http://127.0.0.1:${port}`, NAV);
        await page.waitForSelector('#root', { timeout: 5000 });
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser);
    });

    test('page loads and React mounts', async () => {
        const text = await page.$eval('.brand-text', (el) => el.textContent);
        expect(text).toBe('Squad-Tau');
    });

    test('WebSocket connects and snapshot arrives', async () => {
        await page.goto(`http://127.0.0.1:${port}`, NAV);
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 8000 }, port.toString());
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 8000 });
    }, 12000);

    test('squad init transitions from Welcome view to DAG', async () => {
        await page.goto(`http://127.0.0.1:${port}`, NAV);
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 5000 });

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'Task1', task: 'test', review_criteria: 'ok' }],
            originalTask: 'test',
        });

        await page.waitForFunction(() => !document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 3000 });
        await page.waitForFunction(() => document.body.innerText.includes('Task1'), { timeout: 5000 });
    }, 15000);

    test('session tree shows sessions grouped by node', async () => {
        await page.goto(`http://127.0.0.1:${port}`, NAV);
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 8000 }, port.toString());

        eb.emit('session', 'start', { sessionId: 's1', nodeId: 'NodeA', phase: 'worker', retryCount: 1 });
        eb.emit('session', 'message', {
            sessionId: 's1',
            role: 'assistant',
            content: [{ type: 'text', text: 'Msg from A' }],
            messageId: 'ma1',
        });

        eb.emit('session', 'start', { sessionId: 's2', nodeId: 'NodeB', phase: 'reviewer', retryCount: 1 });
        eb.emit('session', 'message', {
            sessionId: 's2',
            role: 'assistant',
            content: [{ type: 'text', text: 'Msg from B' }],
            messageId: 'mb1',
        });

        await page.waitForFunction(() => document.body.innerText.includes('NodeA'), { timeout: 5000 });
        await page.waitForFunction(() => document.body.innerText.includes('NodeB'), { timeout: 5000 });
        await page.waitForFunction(() => document.body.innerText.includes('R1-worker'), { timeout: 5000 });
        await page.waitForFunction(() => document.body.innerText.includes('R1-reviewer'), { timeout: 5000 });
    }, 15000);

    test('error banner on node failure', async () => {
        await page.goto(`http://127.0.0.1:${port}`, NAV);
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 8000 }, port.toString());

        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'FailNode', task: 'fail', review_criteria: 'none' }],
            originalTask: 'fail test',
        });
        await page.waitForFunction(() => document.body.innerText.includes('FailNode'), { timeout: 5000 });

        eb.emit('squad', 'node_state', {
            nodeId: 'FailNode',
            status: 'failed',
            retryCount: 1,
        });

        await page.waitForFunction(() => document.body.innerText.includes('Squad Failed'), { timeout: 5000 });
    }, 12000);

    test('streaming message deltas update in real-time', async () => {
        const sid = 'stream-sess';

        // Emit squad + session so MessageList renders
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'SNode', task: 'stream', review_criteria: 'ok' }],
            originalTask: 'stream deltas',
        });
        eb.emit('session', 'start', { sessionId: sid, nodeId: 'SNode', phase: 'worker' });

        // Wait for session to be visible (auto-select)
        await page.waitForFunction(() => document.body.innerText.includes('SNode'), { timeout: 8000 });

        // Emit both deltas then wait for accumulated text
        eb.emit('session', 'message_delta', {
            sessionId: sid,
            messageId: 'sm1',
            delta: { type: 'text_delta', text: 'Hello ' },
        });
        eb.emit('session', 'message_delta', {
            sessionId: sid,
            messageId: 'sm1',
            delta: { type: 'text_delta', text: 'world' },
        });

        await page.waitForFunction(() => document.body.innerText.includes('Hello world'), { timeout: 5000 });
    }, 15000);

    test('tool call card renders params and result', async () => {
        await page.goto(`http://127.0.0.1:${port}`, NAV);
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 8000 }, port.toString());

        const sid = 'tool-sess';
        // squad:init needed so MessageList renders (not WelcomeView)
        eb.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'TNode', task: 'tool test', review_criteria: 'ok' }],
            originalTask: 'tool call',
        });
        eb.emit('session', 'start', { sessionId: sid, nodeId: 'TNode', phase: 'worker' });

        // Wait for auto-select before emitting tool events
        await page.waitForFunction(() => document.body.innerText.includes('R1-worker'), { timeout: 5000 });

        eb.emit('session', 'tool_call', {
            sessionId: sid,
            toolName: 'run_test',
            toolId: 'tc1',
            params: { input: 'test-data' },
        });

        // Tool name always visible in header even when collapsed
        await page.waitForFunction(() => document.body.innerText.includes('run_test'), { timeout: 5000 });

        eb.emit('session', 'tool_result', {
            sessionId: sid,
            toolId: 'tc1',
            result: { output: 'passed' },
        });

        // Wait for Result header to appear (React re-render after tool_result)
        await page.waitForFunction(() => document.body.innerText.includes('Result'), { timeout: 5000 });
        // Click to expand the collapsed result section
        await page.evaluate(() => {
            const headers = document.querySelectorAll('[role="button"]');
            for (const h of headers) {
                if (h.textContent.includes('Result')) {
                    h.click();
                    break;
                }
            }
        });
        await page.waitForFunction(() => document.body.innerText.includes('output'), { timeout: 5000 });
    }, 15000);

    test('dark mode class toggles with media query', async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.waitForFunction(() => document.documentElement.className.includes('-dark'), { timeout: 5000 });

        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.waitForFunction(() => !document.documentElement.className.includes('-dark'), { timeout: 5000 });
    }, 10000);
});
