/**
 * Regression UI E2E — verifies REPAIR.md frontend fixes in real browser.
 *
 * Tests:
 * 1. Early-token buffer: push before CE mounts → drain after connect
 * 2. Bundled marked: finalize renders markdown into <strong>/<code>/<a>
 * 3. window.__earlyBuffer API
 *
 * All async waits use page.waitForFunction (MutationObserver-based),
 * never requestAnimationFrame or setTimeout.
 */
import { describe, test, beforeAll, afterAll, expect } from 'bun:test';
import { T } from '../helpers/timeout.test.js';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

describe('Regression: frontend fixes (REPAIR.md §4)', () => {
    let browser, page, baseUrl;

    beforeAll(async () => {
        const srv = await startViteOnly();
        baseUrl = `http://127.0.0.1:${srv.port}`;
        await fetch(baseUrl)
            .then((r) => r.text())
            .catch(() => {});
        const launched = await setupBrowser();
        browser = launched.browser;
        page = launched.page;
        await page.setViewport({ width: 1600, height: 1200 });
        await page.goto(baseUrl, { waitUntil: 'load', timeout: T });
        await page.waitForFunction(() => typeof customElements !== 'undefined' && customElements.get('agent-message'), {
            timeout: T,
        });
    }, 60000);

    afterAll(async () => {
        await teardownBrowser(browser);
        await stopViteOnly();
    }, 60000);

    // ── Early-token buffer test (REPAIR.md §4.1) ──
    test('appendChunk buffers before mount, drains on connect', async () => {
        const ok = await page.evaluate(async () => {
            const AgentMsg = customElements.get('agent-message');
            if (!AgentMsg) return 'CE not registered';
            const el = document.createElement('agent-message');
            el.setAttribute('message-id', 'buf-1');
            if (typeof el.appendChunk !== 'function') return 'no appendChunk';

            // Push tokens before DOM attach — buffers internally
            el.appendChunk('EARLY_', 'text');
            el.appendChunk('BUFFERED', 'text');

            // Attach — connectedCallback drains synchronously
            document.body.appendChild(el);
            const got = el._text || '';
            document.body.removeChild(el);
            return got === 'EARLY_BUFFERED' ? 'ok' : `got "${got}"`;
        });
        expect(ok).toBe('ok');
    });

    test('window.__earlyBuffer API works', async () => {
        const ok = await page.evaluate(() => {
            if (!window.__earlyBuffer) return '__earlyBuffer missing';
            window.__earlyBuffer.push('t1', 'X', 'text');
            window.__earlyBuffer.push('t1', 'Y', 'text');
            const buf = window.__earlyBuffer.read('t1');
            if (!buf || buf.text !== 'XY') return `bad text: ${buf?.text}`;
            // read is non-destructive: second read still returns data
            const buf2 = window.__earlyBuffer.read('t1');
            if (!buf2 || buf2.text !== 'XY') return 'second read lost data';
            window.__earlyBuffer.delete('t1');
            if (window.__earlyBuffer.read('t1') !== null) return 'not cleared after delete';
            return 'ok';
        });
        expect(ok).toBe('ok');
    });

    // ── Bundled marked test (REPAIR.md §4.3) ──
    test('finalize renders markdown via local marked', async () => {
        // Create element and trigger markdown rendering (synchronous now with static import)
        await page.evaluate(async () => {
            const el = document.createElement('agent-message');
            el.setAttribute('message-id', 'md-1');
            document.body.appendChild(el);
            el._text = '**bold** `code` [link](http://x.co)';
            el.finalize();
            // marked.parse is synchronous with static import, but the HTML
            // update goes through shadow DOM slot reassignment (microtask)
        });

        // Use MutationObserver-based waitForFunction — no rAF, no setTimeout
        await page.waitForFunction(
            () => {
                const el = document.querySelector('agent-message[message-id="md-1"]');
                return el?.shadowRoot?.innerHTML?.includes('<strong');
            },
            { timeout: 5000 },
        );

        const mdOk = await page.evaluate(() => {
            const el = document.querySelector('agent-message[message-id="md-1"]');
            if (!el) return 'element lost';
            const html = el.shadowRoot?.innerHTML || '';
            document.body.removeChild(el);
            if (!html.includes('<strong')) return 'no <strong>';
            if (!html.includes('<code')) return 'no <code>';
            if (!html.includes('<a href')) return 'no <a>';
            if (document.querySelector('script[src*="cdn.jsdelivr"]')) return 'has CDN script';
            return 'ok';
        });
        expect(mdOk).toBe('ok');
    });
});
