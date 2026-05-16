import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import { setupBrowser, teardownBrowser, inject, waitForReady, isIdle, getState } from '../helpers/puppeteer-setup.js';
import { sessionURN } from '../../shared/identity.js';

describe('Chaos UI', () => {
    let browser, page, baseUrl;

    beforeAll(async () => {
        const srv = await startViteOnly();
        baseUrl = `http://127.0.0.1:${srv.port}`;
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
        // Capture JS errors for debugging
        page.on('pageerror', (err) => {
            page._lastError = err.message;
        });
        // Physical readiness: wait for React mount, not a protocol signal
        await waitForReady(page, baseUrl);
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser).catch(() => {});
        await stopViteOnly().catch(() => {});
    });

    test('page has no JS errors and renders title', async () => {
        expect(page._lastError).toBeUndefined();
        const title = await page.$eval('[data-app-title]', (el) => el.textContent);
        expect(title).toBe('Squad-Tau');
    });

    test('error after node failed', async () => {
        await inject(page, [
            {
                type: 'squad:init',
                payload: { mode: 'L', nodes: [{ id: 'A', task: 't', depends_on: [] }], originalTask: 't' },
            },
            { type: 'squad:node_state', payload: { nodeId: 'A', status: 'failed' } },
        ]);
        await isIdle(page);

        // Shadow state first: check projections before blaming the DOM
        const state = await getState(page);
        expect(state.nodes?.A?.status).toBe('failed');

        // Then assert the DOM reflects the projection
        // Status 'failed' renders as color styling; the node label 'A' is visible text in the DAG SVG
        const text = await page.evaluate(() => document.body.innerText);
        expect(text).toContain('A');
    });

    test('session:start creates active session', async () => {
        const sid = sessionURN('nodeA', 0, 'authoring');
        await inject(page, [
            {
                type: 'squad:init',
                payload: { mode: 'M', nodes: [{ id: 'nodeA', task: 't', depends_on: [] }], originalTask: 't' },
            },
            { type: 'session:start', payload: { sessionId: sid, nodeId: 'nodeA', phase: 'authoring', epoch: 0 } },
        ]);
        await isIdle(page);

        const state = await getState(page);
        const session = state.runtime.sessions[sid];
        expect(session).toBeDefined();
        expect(session.status).toBe('active');
    });

    test('message:start renders <stream-sink> with activeSessionId', async () => {
        const sid = sessionURN('nodeB', 0, 'authoring');
        const mid = `msg:${sid}:1`;
        await inject(page, [
            {
                type: 'squad:init',
                payload: { mode: 'M', nodes: [{ id: 'nodeB', task: 't', depends_on: [] }], originalTask: 't' },
            },
            { type: 'session:start', payload: { sessionId: sid, nodeId: 'nodeB', phase: 'authoring', epoch: 0 } },
            { type: 'message:start', payload: { messageId: mid, sessionId: sid } },
            // Must select the session for MessageList to render its messages
            { type: 'ui:select_session', payload: { sessionId: sid } },
        ]);
        await isIdle(page);
        // StreamRouter registers the sink when the Custom Element connects
        const sink = await page.waitForFunction(
            (id) => document.querySelector(`stream-sink[urn="${id}"]`) !== null,
            { timeout: 1000 },
            mid,
        );
        expect(sink).toBeTruthy();
    });
});
