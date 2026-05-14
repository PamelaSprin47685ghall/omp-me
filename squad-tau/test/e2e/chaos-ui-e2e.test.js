/**
 * Dehydrated Chaos UI visual correctness.
 *
 * No backend engine. No WS. No db. Pure Vite + direct event injection.
 * Events injected directly into EventStore via window.__es.dispatch.
 * Screenshots and DOM assertions only — purely visual regression.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

function inject(page, events) {
    return page.evaluate((evts) => {
        const es = window.__es;
        for (const e of evts) es.dispatch(e.type, e.payload, e.seq);
    }, events);
}

function reset(page) {
    return page.evaluate(() => window.__es.reset());
}

describe('Chaos: UI visual correctness', () => {
    let browser, page, baseUrl;

    beforeAll(async () => {
        const srv = await startViteOnly();
        baseUrl = `http://127.0.0.1:${srv.port}`;
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await page.waitForSelector('#root', { timeout: 5000 });
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser);
        await stopViteOnly();
    });

    test('error banner shows exact failed/blocked count', async () => {
        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'L',
                    nodes: [
                        { id: 'FailA', task: 'A', review_criteria: 'ok', depends_on: [] },
                        { id: 'FailB', task: 'B', review_criteria: 'ok', depends_on: ['FailA'] },
                        { id: 'FailC', task: 'C', review_criteria: 'ok', depends_on: ['FailA'] },
                    ],
                    originalTask: 'error counts',
                },
            },
            { type: 'squad:node_state', payload: { nodeId: 'FailA', status: 'failed', retryCount: 1 } },
            { type: 'squad:node_state', payload: { nodeId: 'FailB', status: 'blocked', retryCount: 0 } },
            { type: 'squad:node_state', payload: { nodeId: 'FailC', status: 'blocked', retryCount: 0 } },
        ]);

        const bodyText = await page.evaluate(() => document.body.innerText);
        expect(bodyText).toContain('Squad Failed');
        expect(bodyText).toContain('1 failed');
        expect(bodyText).toContain('2 blocked');
    });

    test('session tree labels show retry count and phase', async () => {
        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'M',
                    nodes: [{ id: 'TreeN', task: 'tree', review_criteria: 'ok' }],
                    originalTask: 'tree labels',
                },
            },
            {
                type: 'session:start',
                payload: { sessionId: 'tree-s1', nodeId: 'TreeN', phase: 'worker', retryCount: 1 },
            },
            {
                type: 'session:start',
                payload: { sessionId: 'tree-s2', nodeId: 'TreeN', phase: 'reviewer', retryCount: 2 },
            },
        ]);

        const bodyText = await page.evaluate(() => document.body.innerText);
        expect(bodyText).toContain('R2 worker');
        expect(bodyText).toContain('R3 reviewer');
    });

    test('welcome view appears and disappears on init/abort', async () => {
        await reset(page);
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 3000 });

        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'M',
                    nodes: [{ id: 'WelcomeN', task: 'welcome', review_criteria: 'ok' }],
                    originalTask: 'welcome test',
                },
            },
        ]);
        expect(await page.evaluate(() => document.body.innerText)).not.toContain('Welcome to Squad-Tau');

        await inject(page, [{ type: 'squad:abort', payload: { reason: 'back' } }]);
        expect(await page.evaluate(() => document.body.innerText)).toContain('Welcome to Squad-Tau');
    });

    test('header brand text survives event storms', async () => {
        await reset(page);

        for (let round = 0; round < 4; round++) {
            await inject(page, [
                {
                    type: 'squad:init',
                    payload: {
                        mode: 'M',
                        nodes: [{ id: `Hdr${round}`, task: `hdr ${round}`, review_criteria: 'ok' }],
                        originalTask: `hdr ${round}`,
                    },
                },
                {
                    type: 'session:start',
                    payload: { sessionId: `hdr-s${round}`, nodeId: `Hdr${round}`, phase: 'worker' },
                },
                { type: 'squad:abort', payload: { reason: `abort ${round}` } },
            ]);
        }

        const brand = await page.$eval('[data-app-title]', (el) => el.textContent);
        expect(brand).toBe('Squad-Tau');

        const resp = await fetch(`${baseUrl}/api/status`);
        expect(resp.status).toBe(200);
    });
});
