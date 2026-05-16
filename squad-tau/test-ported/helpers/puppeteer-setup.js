/**
 * Puppeteer helpers — dehydrated, algebraically correct UI testing.
 *
 * Principles:
 * 1. Pure inject — no synthetic events, no business logic in helpers.
 * 2. Physical readiness — wait for React mount via __SQUAD_READY, not timers.
 * 3. Shadow state first — check projections before blaming DOM.
 * 4. Natural timing — RAF for stream flush, isIdle for projection completion.
 */
import puppeteer from 'puppeteer';

export async function setupBrowser() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200 });
    return { browser, page };
}

export async function teardownBrowser(browser) {
    if (!browser) return;
    try {
        const proc = browser.process();
        if (proc) proc.kill();
    } catch {}
    try {
        await browser.close();
    } catch {}
}

/** Pure inject: each event dispatched as-is through window.__es.dispatch().
 *  No synthetic events, no business logic, no fallbacks.
 *  If a fact is missing, the test data is wrong, not the helper. */
export function inject(page, events) {
    return page.evaluate((evts) => {
        const es = window.__es;
        if (!es || typeof es.dispatch !== 'function') return;
        for (const e of evts) {
            es.dispatch(e.type, e.payload, e.seq);
        }
    }, events);
}

/** Wait for EventStore to finish all pending projections (synchronization barrier). */
export function isIdle(page) {
    return page.waitForFunction(() => window.__es?.isIdle?.() ?? true);
}

/** Read the full client-side state tree. Check this before blaming the DOM. */
export function getState(page) {
    return page.evaluate(() => window.__es?.getState?.() ?? null);
}

/** Navigate and wait for React to mount (physical readiness, not protocol).
 *  Warmup fetches trigger Vite JSX compilation before Puppeteer arrives. */
export async function waitForReady(page, baseUrl) {
    // Warm up Vite: fetch main.jsx to trigger compilation before Puppeteer
    // This avoids Vite's lazy compilation delaying React mount.
    await fetch(baseUrl + '/main.jsx')
        .then((r) => r.text())
        .catch(() => {});
    await fetch(baseUrl)
        .then((r) => r.text())
        .catch(() => {});
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.__SQUAD_APP_MOUNTED === true, { timeout: 15000 });
}

/** Wait one requestAnimationFrame (natural StreamRouter flush cycle). */
export function waitForRaf(page) {
    return page.evaluate(() => new Promise(requestAnimationFrame));
}

/** Reset EventStore to initial state. */
export function reset(page) {
    return page.evaluate(() => window.__es?.reset());
}
