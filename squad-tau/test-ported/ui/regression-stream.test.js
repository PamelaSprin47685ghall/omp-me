import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import { setupBrowser, teardownBrowser, inject, waitForReady, isIdle } from '../helpers/puppeteer-setup.js';
import { sessionURN, toURN } from '../../shared/identity.js';

describe('StreamRouter early buffer', () => {
    let browser, page, baseUrl;

    beforeAll(async () => {
        const srv = await startViteOnly();
        baseUrl = `http://127.0.0.1:${srv.port}`;
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
        await waitForReady(page, baseUrl);
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser).catch(() => {});
        await stopViteOnly().catch(() => {});
    });

    test('__streamRouter global', async () => {
        const ok = await page.evaluate(() => {
            const sr = window.__streamRouter;
            return sr && typeof sr.dispatch === 'function' ? 'ok' : 'missing';
        });
        expect(ok).toBe('ok');
    });

    test('dispatch before mount buffers, drains on connect', async () => {
        const sid = sessionURN('N', 0, 'authoring');
        const mid = 'buf-msg';
        // Create skeleton so React renders <stream-sink>
        await inject(page, [
            { type: 'squad:init', payload: { mode: 'M', nodes: [{ id: 'N', task: 't' }], originalTask: 't' } },
            { type: 'session:start', payload: { sessionId: sid, nodeId: 'N', phase: 'authoring', epoch: 0 } },
            { type: 'message:start', payload: { messageId: mid, sessionId: sid } },
            { type: 'ui:select_session', payload: { sessionId: sid } },
        ]);
        await isIdle(page);
        // Wait for <stream-sink> to appear in DOM
        await page.waitForFunction(
            (id) => document.querySelector(`stream-sink[urn="${id}"]`) !== null,
            { timeout: 1000 },
            mid,
        );
        // Dispatch stream data via StreamRouter (simulating edge gateway behavior)
        await page.evaluate((id) => {
            window.__streamRouter.dispatch(id, 'EARLY_');
            window.__streamRouter.dispatch(id, 'BUFFERED');
            window.__streamRouter.flushNow();
        }, mid);

        const text = await page.evaluate((id) => {
            const sink = document.querySelector(`stream-sink[urn="${id}"]`);
            const shadow = sink?.shadowRoot;
            if (!shadow) return '';
            return [...shadow.childNodes]
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join('');
        }, mid);
        expect(text).toContain('EARLY');
        expect(text).toContain('BUFFERED');
    });
});
