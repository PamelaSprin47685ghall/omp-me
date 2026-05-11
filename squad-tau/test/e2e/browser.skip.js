/**
 * Browser UI E2E test.
 * Verifies the React app renders correctly with WebSocket integration.
 * @see PRD/08-testing.md §8.4.1
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer, getGlobalEventBus } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

describe('Browser E2E', () => {
    let browser, page, port;

    beforeAll(async () => {
        process.env.SQUAD_E2E = 'true';
        const result = await startServer();
        port = result.port;
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser);
    });

    test('Page loads and React mounts', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0', timeout: 15000 });

        const root = await page.waitForSelector('#root', { timeout: 10000 });
        expect(root).not.toBeNull();

        // Brand text should be visible
        const brandText = await page.waitForSelector('.brand-text', { timeout: 5000 });
        const text = await brandText.evaluate((el) => el.textContent);
        expect(text).toBe('Squad-Tau');

        // WebSocket should connect and show the port
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 15000 }, port.toString());
    }, 40000);

    test('Squad init event triggers DAG appearance', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0', timeout: 15000 });
        // Wait for connection
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 15000 }, port.toString());

        // Emit squad:init via event bus
        const eventBus = getGlobalEventBus();
        eventBus.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'Task1', task: 'Do work', review_criteria: 'Check quality' }],
            originalTask: 'Test task',
        });

        // The DAG view should appear (Mermaid renders SVG)
        await page.waitForSelector('svg', { timeout: 10000 });

        // Emit session events
        eventBus.emit('session', 'start', {
            sessionId: '101',
            nodeId: 'Task1',
            phase: 'worker',
        });

        eventBus.emit('session', 'message', {
            sessionId: '101',
            role: 'assistant',
            content: [{ type: 'text', text: 'Working on it' }],
            messageId: 'm1',
        });

        // Wait for the message to appear in the UI
        await page.waitForFunction(() => document.body.innerText.includes('Working on it'), { timeout: 5000 });
    }, 40000);

    test('Dark mode class toggles with media query', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0', timeout: 15000 });

        // Switch to dark mode
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.waitForFunction(() => document.documentElement.classList.value.includes('-dark'), { timeout: 5000 });

        // Switch back to light
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.waitForFunction(() => !document.documentElement.classList.value.includes('-dark'), {
            timeout: 5000,
        });
    }, 30000);
});
