/**
 * UI Full Flow — dehydrated event injection (v7).
 *
 * Transformation from the old 17-step Puppeteer test:
 *  - NO clicking, typing, or keyboard simulation
 *  - NO screenshots (visual regression is separate)
 *  - ALL business logic injected as pure facts via inject(page, events)
 *  - DOM assertions via waitForFunction / $eval — not timeouts
 *  - State assertions via getState(page) before blaming the DOM
 *
 * Principles:
 *  1. Pure inject — no synthetic events, no business logic in helpers.
 *  2. Shadow state first — check projections before blaming DOM.
 *  3. Natural timing — isIdle for projection completion, not timers.
 *  4. Zero test logic in page.evaluate — all events are data.
 *
 * @see test/helpers/puppeteer-setup.js inject() for the pure dispatch contract.
 * @see PRD/08-testing.md §Top-Level Real Chaos for the methodology.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import {
    setupBrowser,
    teardownBrowser,
    inject,
    waitForReady,
    isIdle,
    getState,
    reset,
} from '../helpers/puppeteer-setup.js';
import { sessionURN } from '../../shared/identity.js';

describe('UI Full Flow', () => {
    let browser, page, baseUrl;

    beforeAll(async () => {
        const srv = await startViteOnly();
        baseUrl = `http://127.0.0.1:${srv.port}`;
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
        // Physical readiness: wait for React mount, not a protocol signal
        await waitForReady(page, baseUrl);
    }, 20000);

    afterAll(async () => {
        await teardownBrowser(browser).catch(() => {});
        await stopViteOnly().catch(() => {});
    });

    // ── 01 Welcome Page ──

    test('01 welcome page renders title', async () => {
        const title = await page.$eval('[data-app-title]', (el) => el.textContent);
        expect(title).toBe('Squad-Tau');
    });

    // ── 02 DAG Single Node ──

    test('02 squad:init creates DAG node in view and sidebar', async () => {
        await inject(page, [
            {
                type: 'squad:init',
                payload: { mode: 'M', nodes: [{ id: 'calc', task: 'Build calculator' }], originalTask: 'build calc' },
            },
        ]);
        await isIdle(page);

        // Shadow state first: projections should have the node as 'authoring'
        const state = await getState(page);
        expect(state.nodes.calc.status).toBe('authoring');

        // Then DOM: DAG SVG renders the node label
        await page.waitForFunction(() => document.body.innerText.includes('calc'), { timeout: 1000 });

        // Sidebar shows the node with a data-node-label
        const nodeLabel = await page.$eval('[data-node-label]', (el) => el.textContent);
        expect(nodeLabel).toBe('calc');
    });

    // ── 03 Session Lifecycle ──

    test('03 session:start creates active session in sidebar', async () => {
        const sid = sessionURN('calc', 0, 'authoring');
        await inject(page, [
            { type: 'session:start', payload: { sessionId: sid, nodeId: 'calc', phase: 'authoring', epoch: 0 } },
        ]);
        await isIdle(page);

        // State check
        const state = await getState(page);
        const session = state.runtime.sessions[sid];
        expect(session).toBeDefined();
        expect(session.status).toBe('active');

        // DOM: sidebar shows session label with data-session-label
        await page.waitForFunction(() => document.querySelector('[data-session-label]') !== null, { timeout: 1000 });
        const sessLabel = await page.$eval('[data-session-label]', (el) => el.textContent);
        expect(sessLabel).toContain('R1 authoring');
    });

    // ── 04 Message Skeleton + Streaming ──

    test('04 message:start renders <stream-sink>, streaming text via StreamRouter', async () => {
        const sid = sessionURN('calc', 0, 'authoring');
        const mid = 'msg:calc:1';

        // Switch to session view so MessageList renders
        await inject(page, [
            { type: 'message:start', payload: { messageId: mid, sessionId: sid } },
            { type: 'ui:select_session', payload: { sessionId: sid } },
        ]);
        await isIdle(page);

        // <stream-sink> with matching URN must be in the DOM
        const sink = await page.waitForFunction(
            (id) => document.querySelector(`stream-sink[urn="${id}"]`) !== null,
            { timeout: 2000 },
            mid,
        );
        expect(sink).toBeTruthy();

        // Dispatch stream text through StreamRouter (simulating edge gateway delta)
        await page.evaluate((id) => {
            window.__streamRouter.dispatch(id, 'Building a calculator...');
            window.__streamRouter.flushNow();
        }, mid);

        // Verify text in shadow DOM (TextNode after <style>)
        const text = await page.evaluate((id) => {
            const sink = document.querySelector(`stream-sink[urn="${id}"]`);
            if (!sink || !sink.shadowRoot) return '';
            return [...sink.shadowRoot.childNodes]
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join('');
        }, mid);
        expect(text).toBe('Building a calculator...');

        // Dispatch more streaming text (appendData, not replace)
        await page.evaluate((id) => {
            window.__streamRouter.dispatch(id, '\nStep 1: parse input');
            window.__streamRouter.flushNow();
        }, mid);

        const text2 = await page.evaluate((id) => {
            const sink = document.querySelector(`stream-sink[urn="${id}"]`);
            if (!sink || !sink.shadowRoot) return '';
            return [...sink.shadowRoot.childNodes]
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join('');
        }, mid);
        expect(text2).toContain('Building a calculator...');
        expect(text2).toContain('Step 1: parse input');
    });

    // ── 05 Message Finalized ──

    test('05 message:finalized updates status in DOM and state', async () => {
        const mid = 'msg:calc:1';

        await inject(page, [
            {
                type: 'message:finalized',
                payload: { messageId: mid, staticContent: 'Building a calculator...\nStep 1: parse input' },
            },
        ]);
        await isIdle(page);

        // State check: skeleton finalized with content
        const state = await getState(page);
        expect(state.messages[mid].status).toBe('finalized');
        expect(state.messages[mid].staticContent).toContain('Building a calculator');

        // DOM: the streaming text is in <stream-sink> shadow DOM, not body.innerText
        const shadowText = await page.evaluate((id) => {
            const sink = document.querySelector(`stream-sink[urn="${id}"]`);
            if (!sink || !sink.shadowRoot) return '';
            return [...sink.shadowRoot.childNodes]
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join('');
        }, mid);
        expect(shadowText).toContain('Building a calculator');
    });

    // ── 06 Tool Call Lifecycle ──

    test('06 tool_call:started adds toolCall entity in state', async () => {
        const mid = 'msg:calc:1';
        const tid = 't1';

        // Inject tool_call:started linked to the existing message
        await inject(page, [
            {
                type: 'tool_call:started',
                payload: {
                    sessionId: sessionURN('calc', 0, 'authoring'),
                    toolName: 'read',
                    toolId: tid,
                    params: { path: 'calc.js' },
                    messageId: mid,
                },
            },
        ]);
        await isIdle(page);

        const state = await getState(page);
        expect(state.toolCalls[tid]).toBeDefined();
        expect(state.toolCalls[tid].toolName).toBe('read');
        expect(state.toolCalls[tid].status).toBe('running');

        // Message should reference the tool
        expect(state.messages[mid].toolIds).toContain(tid);

        // Finish the tool (success)
        await inject(page, [
            {
                type: 'tool_call:finished',
                payload: { toolId: tid, result: { content: [{ type: 'text', text: 'ok' }] }, isError: false },
            },
        ]);
        await isIdle(page);

        const state2 = await getState(page);
        expect(state2.toolCalls[tid].status).toBe('done');
        expect(state2.toolCalls[tid].isError).toBe(false);
    });

    test('07 tool_call:finished with error marks isError', async () => {
        const tid = 't-err';
        const sid = sessionURN('calc', 0, 'authoring');
        const mid = 'msg-err';

        await inject(page, [
            { type: 'message:start', payload: { messageId: mid, sessionId: sid } },
            {
                type: 'tool_call:started',
                payload: {
                    sessionId: sid,
                    toolName: 'bash',
                    toolId: tid,
                    params: { command: 'rm -rf /' },
                    messageId: mid,
                },
            },
        ]);
        await isIdle(page);

        // Finish with error
        await inject(page, [
            {
                type: 'tool_call:finished',
                payload: { toolId: tid, result: { error: 'Permission denied' }, isError: true },
            },
        ]);
        await isIdle(page);

        const state = await getState(page);
        expect(state.toolCalls[tid].isError).toBe(true);
        expect(state.toolCalls[tid].status).toBe('done');
    });

    // ── 08 Node Failed Banner ──

    test('08 node:failed renders error alert with summary', async () => {
        // Switch to DAG view first — error alert only renders in viewMode 'dag'
        await inject(page, [
            { type: 'ui:set_view_mode', payload: { viewMode: 'dag' } },
            {
                type: 'squad:node_state',
                payload: { nodeId: 'calc', status: 'failed', retryCount: 1, summary: 'Calculator crashed' },
            },
        ]);
        await isIdle(page);

        // State check
        const state = await getState(page);
        expect(state.nodes.calc.status).toBe('failed');

        // DOM: error Alert must render with the summary
        await page.waitForFunction(
            () =>
                document.body.innerText.includes('Squad Failed') &&
                document.body.innerText.includes('Calculator crashed'),
            { timeout: 2000 },
        );
    });

    // ── 09 Success Banner ──

    test('09 squad:complete renders success alert', async () => {
        // Switch to DAG view first — success alert only renders in viewMode 'dag'
        await inject(page, [
            { type: 'ui:set_view_mode', payload: { viewMode: 'dag' } },
            {
                type: 'squad:node_state',
                payload: { nodeId: 'calc', status: 'approved', retryCount: 0, summary: 'Calculator finished' },
            },
            {
                type: 'squad:complete',
                payload: {
                    results: [
                        { id: 'calc', status: 'approved', summary: 'Calculator finished', affectedFiles: ['app.js'] },
                    ],
                },
            },
        ]);
        await isIdle(page);

        // State check
        const state = await getState(page);
        expect(state.squad.status).toBe('complete');

        // DOM: success Alert must render
        await page.waitForFunction(() => document.body.innerText.includes('Squad completed successfully'), {
            timeout: 2000,
        });
    });

    // ── 10 Multi-Node DAG ──

    test('10 multi-node DAG renders three nodes with different statuses', async () => {
        await reset(page);

        // Inject a full diamond topology in one batch
        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'L',
                    nodes: [
                        { id: 'A', task: 'task A', review_criteria: ['ok'], depends_on: [] },
                        { id: 'B', task: 'task B', review_criteria: ['ok'], depends_on: [] },
                        { id: 'C', task: 'task C', review_criteria: ['ok'], depends_on: ['A', 'B'] },
                    ],
                    originalTask: 'diamond',
                },
            },
            { type: 'squad:node_state', payload: { nodeId: 'A', status: 'approved', retryCount: 0 } },
            { type: 'squad:node_state', payload: { nodeId: 'B', status: 'failed', retryCount: 0 } },
            { type: 'squad:node_state', payload: { nodeId: 'C', status: 'blocked', retryCount: 0 } },
        ]);
        await isIdle(page);

        // State check: all three nodes exist with correct statuses
        const state = await getState(page);
        expect(state.nodes.A.status).toBe('approved');
        expect(state.nodes.B.status).toBe('failed');
        expect(state.nodes.C.status).toBe('blocked');

        // DOM: all three node IDs visible
        const text = await page.evaluate(() => document.body.innerText);
        expect(text).toContain('A');
        expect(text).toContain('B');
        expect(text).toContain('C');

        // Sidebar shows blocked status text
        expect(text).toContain('blocked');
    });

    // ── 11 Drawer with Capacity ──

    test('11 drawer opens and reflects config:capacity_changed', async () => {
        // Open drawer via ui:toggle_drawer
        await inject(page, [{ type: 'ui:toggle_drawer', payload: { open: true } }]);
        await isIdle(page);

        // Wait for drawer content
        await page.waitForFunction(() => document.body.innerText.includes('Runtime Metrics'), { timeout: 1000 });

        // Change capacity
        await inject(page, [{ type: 'config:capacity_changed', payload: { maxWorkers: 5 } }]);
        await isIdle(page);

        // DOM should show the new value
        await page.waitForFunction(() => document.body.innerText.includes('5'), { timeout: 1000 });

        // Close drawer
        await inject(page, [{ type: 'ui:toggle_drawer', payload: { open: false } }]);
        await isIdle(page);
    });

    // ── 12 Abort Returns to Welcome ──

    test('12 squad:abort resets squad status and returns to welcome view', async () => {
        await reset(page);
        // Seed a squad so the view is not already on welcome
        await inject(page, [
            { type: 'squad:init', payload: { mode: 'M', nodes: [{ id: 'tmp', task: 't' }], originalTask: 't' } },
        ]);
        await isIdle(page);
        const text1 = await page.evaluate(() => document.body.innerText);
        expect(text1).toContain('tmp');

        // Abort
        await inject(page, [{ type: 'squad:abort', payload: { reason: 'user cancelled' } }]);
        await isIdle(page);

        // State check
        const state = await getState(page);
        expect(state.squad.status).toBe('aborted');

        // DOM: welcome view should be back
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 2000 });
    });

    // ── 13 Interleaved Streaming Causality ──

    test('13 interleaved streaming: text chunks accumulate in correct order', async () => {
        await reset(page);

        const sid = sessionURN('flow', 0, 'authoring');
        const mid = 'm-interleave';

        // Seed the session + message skeleton
        await inject(page, [
            {
                type: 'squad:init',
                payload: { mode: 'M', nodes: [{ id: 'flow', task: 'flow test' }], originalTask: 'flow' },
            },
            { type: 'session:start', payload: { sessionId: sid, nodeId: 'flow', phase: 'authoring', epoch: 0 } },
            { type: 'message:start', payload: { messageId: mid, sessionId: sid } },
            { type: 'ui:select_session', payload: { sessionId: sid } },
        ]);
        await isIdle(page);

        // Wait for <stream-sink> to render
        await page.waitForFunction(
            (id) => document.querySelector(`stream-sink[urn="${id}"]`) !== null,
            { timeout: 2000 },
            mid,
        );

        // Simulate streaming: text chunk 1 → tool call → text chunk 2
        // In the new architecture, all streaming text goes to the same TextNode
        // via StreamRouter (appendData). Tool calls are entity subscriptions.
        await page.evaluate((id) => {
            window.__streamRouter.dispatch(id, 'First thought...');
            window.__streamRouter.flushNow();
        }, mid);

        // Inject tool call (state-level — tool calls don't block TextNode streaming)
        await inject(page, [
            {
                type: 'tool_call:started',
                payload: {
                    sessionId: sid,
                    toolName: 'read',
                    toolId: 't-flow',
                    params: { path: 'test/file.js' },
                    messageId: mid,
                },
            },
        ]);
        await isIdle(page);

        // Continue streaming on the same TextNode
        await page.evaluate((id) => {
            window.__streamRouter.dispatch(id, ' Second thought...');
            window.__streamRouter.flushNow();
        }, mid);

        // Verify accumulated streaming text order
        const text = await page.evaluate((id) => {
            const sink = document.querySelector(`stream-sink[urn="${id}"]`);
            if (!sink || !sink.shadowRoot) return '';
            return [...sink.shadowRoot.childNodes]
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join('');
        }, mid);
        expect(text).toContain('First thought...');
        expect(text).toContain('Second thought...');

        // Verify causal order in the TextNode
        const firstIdx = text.indexOf('First thought...');
        const secondIdx = text.indexOf('Second thought...');
        expect(firstIdx).toBeGreaterThanOrEqual(0);
        expect(secondIdx).toBeGreaterThan(firstIdx);
    });
});
