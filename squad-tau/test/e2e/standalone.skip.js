/**
 * Standalone Puppeteer E2E tests (without OMP).
 * @see PRD/08-testing.md §8.4.2
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer } from '../../server/server-lifecycle.js';
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
        // We don't stop the server here to allow the next test file to reuse it
        // since bun test runs them in the same process and server is a singleton.
    });

    test('Page loads and React mounts', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });

        // Check for root element
        const root = await page.$('#root');
        expect(root).not.toBeNull();

        // Check for brand text
        const brandText = await page.waitForSelector('.brand-text');
        const text = await brandText.evaluate((el) => el.textContent);
        expect(text).toBe('Squad-Tau');
    }, 15000);

    test('WebSocket connects and snapshot arrives', async () => {
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });

        // Wait for the connected indicator (port text appearing in Header)
        await page.waitForFunction(
            (p) => {
                return document.body.innerText.includes(p);
            },
            { timeout: 10000 },
            port.toString(),
        );

        // Verify WelcomeView is visible (default when no squad active)
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 10000 });
    }, 15000);
});
