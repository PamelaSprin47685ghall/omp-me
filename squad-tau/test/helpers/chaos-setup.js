/**
 * Shared chaos test setup — singleton server, reference-counted browser factory.
 * Multiple test files can call setupChaos/teardownChaos in parallel safely.
 * Server is only stopped on process exit, never during individual file teardown.
 */
import { startServer, getGlobalEventBus, stopServer } from '../../server/server-lifecycle.js';
import { setupBrowser, teardownBrowser } from './puppeteer-setup.js';

let started = false;
let cleanupRegistered = false;

async function cleanup() {
    try {
        await stopServer();
    } catch {}
}

export async function setupChaos() {
    process.env.SQUAD_E2E = '1';
    const r = await startServer();
    if (!started) {
        started = true;
        // Use beforeExit + exit to catch both clean and forced exits
        process.on('beforeExit', cleanup);
        process.on('exit', () => {
            stopServer().catch(() => {});
        });
    }
    const { browser, page } = await setupBrowser();
    return {
        port: r.port,
        browser,
        page,
        eb: getGlobalEventBus(),
        baseUrl: `http://127.0.0.1:${r.port}`,
        wsUrl: `ws://127.0.0.1:${r.port}/ws`,
    };
}

export async function teardownChaos(browser) {
    // Close all pages first, then the browser
    if (browser) {
        const pages = await browser.pages();
        for (const p of pages) {
            try {
                await p.close();
            } catch {}
        }
        await teardownBrowser(browser);
    }
}
