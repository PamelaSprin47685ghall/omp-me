/**
 * Standalone Puppeteer E2E tests (merged).
 * @see PRD/08-testing.md §8.4.1, §8.4.2
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, getGlobalEventBus } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

describe('Standalone E2E', () => {
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
        // afterAll MUST NOT stopServer (other e2e tests reuse the singleton server)
    });

    test('page loads and React mounts', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0', timeout: 10000 });
        await page.waitForSelector('#root', { timeout: 5000 });
        const text = await page.$eval('.brand-text', (el) => el.textContent);
        expect(text).toBe('Squad-Tau');
    }, 10000);

    test('WebSocket connects and snapshot arrives', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0', timeout: 10000 });
        // Wait for connection (port text in header)
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 10000 }, port.toString());
        // Verify WelcomeView
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 10000 });
    }, 15000);

    test('squad init event triggers DAG appearance', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0', timeout: 10000 });
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 10000 }, port.toString());

        const eventBus = getGlobalEventBus();
        eventBus.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'Task1', task: 'Do work', review_criteria: 'Check quality' }],
            originalTask: 'Test task',
        });

        // Wait for SVG (Mermaid renders DAG)
        await page.waitForSelector('svg', { timeout: 10000 });

        eventBus.emit('session', 'start', { sessionId: '101', nodeId: 'Task1', phase: 'worker' });
        eventBus.emit('session', 'message', {
            sessionId: '101',
            role: 'assistant',
            content: [{ type: 'text', text: 'Working on it' }],
            messageId: 'm1',
        });

        await page.waitForFunction(() => document.body.innerText.includes('Working on it'), { timeout: 10000 });
    }, 20000);

    test('dark mode class toggles with media query', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0', timeout: 10000 });

        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.waitForFunction(() => document.documentElement.className.includes('-dark'), { timeout: 5000 });

        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.waitForFunction(() => !document.documentElement.className.includes('-dark'), { timeout: 5000 });
    }, 15000);
});
