import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import { setupBrowser, teardownBrowser, inject, waitForReady, isIdle, getState } from '../helpers/puppeteer-setup.js';
import { sessionURN } from '../../shared/identity.js';

describe('StreamSink UI', () => {
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

    test('squad:init creates DAG node', async () => {
        await inject(page, [
            { type: 'squad:init', payload: { mode: 'M', nodes: [{ id: 'fn', task: 'b' }], originalTask: 'b' } },
        ]);
        await isIdle(page);

        const state = await getState(page);
        expect(state.nodes?.fn?.status).toBe('authoring');
        await page.waitForFunction(() => document.body.innerText.includes('fn'), { timeout: 1000 });
    });

    test('message:start renders <stream-sink> with activeSessionId', async () => {
        const sid = sessionURN('fn', 0, 'authoring');
        const mid = 'm1';
        await inject(page, [
            { type: 'squad:init', payload: { mode: 'M', nodes: [{ id: 'fn', task: 'b' }], originalTask: 'b' } },
            { type: 'session:start', payload: { sessionId: sid, nodeId: 'fn', phase: 'authoring', epoch: 0 } },
            { type: 'message:start', payload: { messageId: mid, sessionId: sid } },
            { type: 'ui:select_session', payload: { sessionId: sid } },
        ]);
        await isIdle(page);

        const state = await getState(page);
        expect(state.messages?.[mid]?.status).toBe('streaming');
        expect(state.ui.activeSessionId).toBe(sid);

        await page.waitForFunction(
            (id) => document.querySelector(`stream-sink[urn="${id}"]`) !== null,
            { timeout: 1000 },
            mid,
        );
    });

    test('StreamRouter dispatches to <stream-sink>', async () => {
        const sid = sessionURN('fn', 0, 'authoring');
        const mid = 'm2';
        // Create squad, session, and message skeleton
        await inject(page, [
            { type: 'squad:init', payload: { mode: 'M', nodes: [{ id: 'fn', task: 'b' }], originalTask: 'b' } },
            { type: 'session:start', payload: { sessionId: sid, nodeId: 'fn', phase: 'authoring', epoch: 0 } },
            { type: 'message:start', payload: { messageId: mid, sessionId: sid } },
            { type: 'ui:select_session', payload: { sessionId: sid } },
        ]);
        await isIdle(page);
        // Wait for <stream-sink> DOM element
        await page.waitForFunction(
            (id) => document.querySelector(`stream-sink[urn="${id}"]`) !== null,
            { timeout: 1000 },
            mid,
        );
        // Dispatch stream text through StreamRouter (simulating edge gateway delta)
        await page.evaluate((id) => {
            window.__streamRouter.dispatch(id, 'Hello!');
            window.__streamRouter.flushNow();
        }, mid);
        // Check the text in shadow DOM — textContent includes <style>, use last child's data
        const text = await page.evaluate((id) => {
            const sink = document.querySelector(`stream-sink[urn="${id}"]`);
            const shadow = sink?.shadowRoot;
            if (!shadow) return '';
            // Last child is the TextNode after the <style> element
            return [...shadow.childNodes]
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join('');
        }, mid);
        expect(text).toBe('Hello!');
    });
});
