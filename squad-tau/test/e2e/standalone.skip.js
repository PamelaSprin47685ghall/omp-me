/**
 * Standalone Puppeteer E2E tests — fast.
 * Uses domcontentloaded instead of networkidle0 (Vite HMR makes networkidle0 slow).
 * @see PRD/08-testing.md §8.4.1, §8.4.2
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, getGlobalEventBus } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

const NAV_OPTS = { waitUntil: 'domcontentloaded', timeout: 8000 };

describe('Standalone E2E', () => {
    let browser, page, port;

    beforeAll(async () => {
        process.env.SQUAD_E2E = 'true';
        const result = await startServer();
        port = result.port;
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
        // One shared navigation — tests that need a fresh page do their own goto
        await page.goto(`http://127.0.0.1:${port}`, NAV_OPTS);
        await page.waitForSelector('#root', { timeout: 5000 });
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser);
    });

    test('page loads and React mounts', async () => {
        // beforeAll already navigated and waited for #root
        const text = await page.$eval('.brand-text', (el) => el.textContent);
        expect(text).toBe('Squad-Tau');
    }, 8000);

    test('WebSocket connects and snapshot arrives', async () => {
        await page.goto(`http://127.0.0.1:${port}`, NAV_OPTS);
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 8000 }, port.toString());
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 8000 });
    }, 12000);

    test('squad init event triggers DAG appearance', async () => {
        await page.goto(`http://127.0.0.1:${port}`, NAV_OPTS);
        await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 8000 }, port.toString());

        const eventBus = getGlobalEventBus();
        eventBus.emit('squad', 'init', {
            mode: 'M',
            nodes: [{ id: 'Task1', task: 'Do work', review_criteria: 'Check quality' }],
            originalTask: 'Test task',
        });

        // Mermaid renders DAG as SVG
        await page.waitForSelector('svg', { timeout: 8000 });

        eventBus.emit('session', 'start', { sessionId: '101', nodeId: 'Task1', phase: 'worker' });
        eventBus.emit('session', 'message', {
            sessionId: '101',
            role: 'assistant',
            content: [{ type: 'text', text: 'Working on it' }],
            messageId: 'm1',
        });

        await page.waitForFunction(() => document.body.innerText.includes('Working on it'), { timeout: 8000 });
    }, 15000);

    test('dark mode class toggles with media query', async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.waitForFunction(() => document.documentElement.className.includes('-dark'), { timeout: 5000 });

        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.waitForFunction(() => !document.documentElement.className.includes('-dark'), { timeout: 5000 });
    }, 10000);
});
