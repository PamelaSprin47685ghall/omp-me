/**
 * Browser UI E2E tests using standalone approach.
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

        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });
        // Wait for connection
        await page.waitForFunction(
            (p) => {
                return document.body.innerText.includes(p);
            },
            { timeout: 10000 },
            port.toString(),
        );
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser);
        await stopServer();
    });

    test('Interact with UI and simulate events', async () => {
        // 1. Verify basic elements
        await page.waitForSelector('#root', { timeout: 10000 });
        const brandText = await page.waitForSelector('.brand-text', { timeout: 10000 });
        expect(await brandText.evaluate((el) => el.textContent)).toBe('Squad-Tau');

        // 2. Simulate squad events
        const eventBus = getGlobalEventBus();

        // Emit squad:init
        eventBus.emit('squad', 'init', {
            nodes: [{ id: 'Task1', type: 'worker', status: 'pending', dependencies: [] }],
        });

        // DAGView should appear (wait for svg element)
        await page.waitForSelector('svg', { timeout: 10000 });

        // Emit session:start
        eventBus.emit('session', 'start', {
            sessionId: '101',
            nodeId: 'Task1',
            status: 'active',
            phase: 'Working',
            retryCount: 1,
        });

        // Verify status in Sidebar (R1-Working)
        await page.waitForFunction(() => document.body.innerText.includes('R1-Working'), { timeout: 10000 });

        // MainContent should show StatusBar for Task1
        await page.waitForSelector('[class*="-tag"]', { timeout: 10000 });
        const bodyText = await page.evaluate(() => document.body.innerText);
        expect(bodyText).toContain('Node: Task1');
    }, 40000);

    test('Dark mode class presence', async () => {
        // Toggle dark mode via media query emulation
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        // Blueprint uses -dark class on html or body
        await page.waitForFunction(() => document.documentElement.classList.value.includes('-dark'), { timeout: 5000 });

        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.waitForFunction(() => !document.documentElement.classList.value.includes('-dark'), {
            timeout: 5000,
        });
    }, 15000);
});
