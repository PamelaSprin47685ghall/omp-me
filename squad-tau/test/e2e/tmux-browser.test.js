/**
 * Tmux Browser E2E — Verifies Squad-Tau UI rendering via synthetic event injection.
 *
 * Starts the HTTP+WS+Vite server programmatically, connects Puppeteer, then
 * injects events through the eventBus (which broadcasts via WS to the client).
 * This tests the full pipeline: eventBus → ws-server → WebSocket → React → DOM.
 *
 * Each test creates its own page for clean slate. Zero sleep() — all waiting
 * is done via polling predicates (waitForFunction / waitForSelector).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startServer, stopServer } from '../../server/server-lifecycle.js';
import { register, unregister } from '../../server/session-registry.js';
import { setupBrowser, teardownBrowser, waitForAppWebSocket } from '../helpers/puppeteer-setup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForText(page, pattern, timeoutMs = 8000) {
    try {
        if (typeof pattern === 'string') {
            await page.waitForFunction((p) => document.body.textContent.includes(p), { timeout: timeoutMs }, pattern);
        } else {
            await page.waitForFunction((p) => p.test(document.body.textContent), { timeout: timeoutMs }, pattern);
        }
        return true;
    } catch {
        return false;
    }
}

function waitForSelector(page, selector, timeoutMs = 8000) {
    return page
        .waitForSelector(selector, { timeout: timeoutMs })
        .then(() => true)
        .catch(() => false);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Tmux Browser — UI Content', () => {
    let browser, port, eventBus;

    beforeAll(async () => {
        process.env.SQUAD_E2E = '1';
        const server = await startServer();
        port = server.port;
        eventBus = server.eventBus;
        const b = await setupBrowser();
        browser = b.browser;

        // Register e2e test session IDs so backend accepts session:user_message
        const testSessions = ['sess-1', 's1', 'sess-a', 'sess-b', 's-a', 's-b', 's-x', 's-y'];
        for (const sid of testSessions) {
            register(sid, { sendUserMessage: () => {}, session: null, status: 'authoring' });
        }
    }, 60000);

    afterAll(async () => {
        await teardownBrowser(browser);
        ['sess-1', 's1', 'sess-a', 'sess-b', 's-a', 's-b', 's-x', 's-y'].forEach(unregister);
        await stopServer();
    });

    async function createPage() {
        const p = await browser.newPage();
        await p.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppWebSocket(p, 20000);
        return p;
    }

    // ── 1. Welcome View ──────────────────────────────────────────────────────

    test('shows Welcome view on initial load', async () => {
        const page = await createPage();
        try {
            expect(await waitForText(page, 'Squad-Tau')).toBe(true);
            expect(await waitForText(page, 'Welcome to Squad-Tau')).toBe(true);
            expect(await waitForText(page, '/squad')).toBe(true);
            expect(await waitForText(page, 'Configure Model Pool')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 2. DAG View ──────────────────────────────────────────────────────────

    test('squad:init renders DAG View with node names', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'L',
                nodes: [
                    { id: 'scan-files', task: 'Scan files', review_criteria: [], depends_on: [] },
                    { id: 'parse-config', task: 'Parse config', review_criteria: [], depends_on: ['scan-files'] },
                ],
                originalTask: 'test',
            });
            expect(await waitForText(page, 'DAG View')).toBe(true);
            expect(await waitForText(page, 'scan-files')).toBe(true);
            expect(await waitForText(page, 'parse-config')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 3. Session Sidebar ───────────────────────────────────────────────────

    test('session:start creates sidebar entry and activates message input', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'node1', task: 'Test', review_criteria: [] }],
                originalTask: 'test',
            });
            // wait until squad:init takes effect (nodes appear in DAG)
            await waitForText(page, 'node1', 5000);

            eventBus.emit('session', 'start', { sessionId: 'sess-1', nodeId: 'node1', phase: 'worker', retryCount: 0 });
            expect(await waitForText(page, 'R1-worker')).toBe(true);
            expect(await waitForText(page, 'node1')).toBe(true);
            expect(await waitForSelector(page, 'textarea')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 4. Thinking Delta ────────────────────────────────────────────────────

    test('thinking_delta renders Thinking block with content', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            // session must be visible in sidebar before we send message
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'msg-t1',
                delta: { type: 'thinking_delta', text: 'Analyzing step by step...' },
            });
            expect(await waitForText(page, 'Thinking')).toBe(true);
            expect(await waitForText(page, 'Analyzing step by step...')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 5. Text Delta ────────────────────────────────────────────────────────

    test('text_delta renders assistant message text', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'msg-txt-1',
                delta: { type: 'text_delta', text: 'Here is the result of my analysis.' },
            });
            expect(await waitForText(page, 'Here is the result of my analysis.')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 6. Tool Call ─────────────────────────────────────────────────────────

    test('tool_call renders tool name and parameters', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'tool_call', {
                sessionId: 's1',
                toolName: 'read_file',
                toolId: 't1',
                params: { filepath: '/tmp/test.txt', lineCount: 50 },
            });
            expect(await waitForText(page, 'read_file')).toBe(true);
            expect(await waitForText(page, 'filepath')).toBe(true);
            expect(await waitForText(page, '/tmp/test.txt')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 7. Tool Result ───────────────────────────────────────────────────────

    test('tool_result renders result section with content', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'tool_call', {
                sessionId: 's1',
                toolName: 'read_file',
                toolId: 't1',
                params: { filepath: '/tmp/test.txt' },
            });
            await waitForText(page, 'read_file', 5000);

            eventBus.emit('session', 'tool_result', {
                sessionId: 's1',
                toolId: 't1',
                result: { content: 'file contents here', lines: 42 },
                isError: false,
            });
            expect(await waitForText(page, 'Result')).toBe(true);
            expect(await waitForText(page, 'file contents here')).toBe(true);
            expect(await waitForText(page, '42')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 8. Full message replaces delta ───────────────────────────────────────

    test('session:message replaces delta-built message', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'msg-final',
                delta: { type: 'text_delta', text: 'Intermediate...' },
            });
            expect(await waitForText(page, 'Intermediate...')).toBe(true);

            eventBus.emit('session', 'message', {
                sessionId: 's1',
                role: 'assistant',
                content: [{ type: 'text', text: 'Final complete message content.' }],
                messageId: 'msg-final',
            });
            expect(await waitForText(page, 'Final complete message content.')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 9. Node State Changes ────────────────────────────────────────────────

    test('squad:node_state updates show in DAG view', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'node-a', task: 'Task A', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'DAG View', 5000);
            expect(await waitForText(page, 'node-a')).toBe(true);

            eventBus.emit('squad', 'node_state', { nodeId: 'node-a', status: 'authoring', retryCount: 0 });
            await waitForText(page, 'node-a', 5000);

            eventBus.emit('squad', 'node_state', { nodeId: 'node-a', status: 'approved', retryCount: 0 });
            expect(await waitForText(page, 'node-a')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 10. Session End ──────────────────────────────────────────────────────

    test('session:end disables input with completion text', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'end', { sessionId: 's1', reason: 'completed' });

            // Wait for the placeholder to update (textarea placeholder not in innerText)
            const placeholderUpdated = await page
                .waitForFunction(() => document.querySelector('textarea')?.placeholder === 'Session completed', {
                    timeout: 8000,
                })
                .then(() => true)
                .catch(() => false);
            expect(placeholderUpdated).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 11. Squad Complete ───────────────────────────────────────────────────

    test('squad:complete shows Squad Completed Successfully banner', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            // Wait for the DAG to appear so we know init was processed
            await waitForText(page, 'n1', 5000);

            eventBus.emit('squad', 'complete', {
                results: [{ id: 'n1', status: 'approved', summary: 'done', affectedFiles: ['f1.js'] }],
                durationMs: 5000,
            });
            expect(await waitForText(page, 'Squad Completed Successfully')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 12. Error Banner ─────────────────────────────────────────────────────

    test('failed node shows Squad Failed error banner', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'Task', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);

            eventBus.emit('squad', 'node_state', {
                nodeId: 'n1',
                status: 'failed',
                retryCount: 0,
                summary: 'Something went wrong',
            });

            eventBus.emit('squad', 'complete', {
                results: [{ id: 'n1', status: 'failed', summary: 'Something went wrong', affectedFiles: [] }],
                durationMs: 3000,
            });
            expect(await waitForText(page, 'Squad Failed')).toBe(true);
            expect(await waitForText(page, 'Something went wrong')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 13. Multi-session ────────────────────────────────────────────────────

    test('multiple sessions show in sidebar, content per session', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'L',
                nodes: [
                    { id: 'nodeA', task: 'A', review_criteria: [] },
                    { id: 'nodeB', task: 'B', review_criteria: [] },
                ],
                originalTask: 'multi',
            });
            await waitForText(page, 'nodeA', 5000);

            // Session A
            eventBus.emit('session', 'start', { sessionId: 'sess-a', nodeId: 'nodeA', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'message_delta', {
                sessionId: 'sess-a',
                messageId: 'ma-1',
                delta: { type: 'text_delta', text: 'Result from node A' },
            });
            // Wait for session A's message to render
            expect(await waitForText(page, 'Result from node A')).toBe(true);

            // Session B
            eventBus.emit('session', 'start', { sessionId: 'sess-b', nodeId: 'nodeB', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'nodeB', 5000);
            await page.evaluate(() => window.__selectLatestSession?.());

            eventBus.emit('session', 'message_delta', {
                sessionId: 'sess-b',
                messageId: 'mb-1',
                delta: { type: 'text_delta', text: 'Result from node B' },
            });
            expect(await waitForText(page, 'Result from node B')).toBe(true);

            // Both nodes in sidebar
            expect(await waitForText(page, 'nodeA')).toBe(true);
            expect(await waitForText(page, 'nodeB')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 14. Page reload resilience ───────────────────────────────────────────

    test('page reload reconnects WebSocket and renders content', async () => {
        const page = await createPage();
        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
            const connected = await waitForAppWebSocket(page, 20000);
            expect(connected).toBe(true);
            expect(await waitForText(page, 'Squad-Tau')).toBe(true);
            expect(await waitForText(page, 'Welcome to Squad-Tau')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 15. Empty messages placeholder ───────────────────────────────────────

    test('session with no messages shows empty placeholder', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            expect(await waitForText(page, 'No messages yet')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 16. Model Pool Drawer ────────────────────────────────────────────────

    test('Model Pool Drawer opens via button click and closes via Escape', async () => {
        const page = await createPage();
        try {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find((b) =>
                    b.textContent.includes('Configure Model Pool'),
                );
                if (btn) btn.click();
            });
            expect(await waitForText(page, 'Model Pool Configuration')).toBe(true);
            // Verify drawer portal is rendered
            const portalExists = await page
                .waitForSelector('[class*="bp6-drawer"]', { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            expect(portalExists).toBe(true);

            await page.keyboard.press('Escape');
            const closed = await page
                .waitForFunction(() => !document.body.textContent.includes('Model Pool Configuration'), {
                    timeout: 5000,
                })
                .then(() => true)
                .catch(() => false);
            expect(closed).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 17. Switch session via sidebar content click ───────────────────────────

    test('click sidebar session leaf switches active messages', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'L',
                nodes: [
                    { id: 'alpha', task: 'Alpha', review_criteria: [] },
                    { id: 'beta', task: 'Beta', review_criteria: [] },
                ],
                originalTask: 'multi',
            });
            await waitForText(page, 'alpha', 5000);

            eventBus.emit('session', 'start', { sessionId: 's-a', nodeId: 'alpha', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);
            eventBus.emit('session', 'message_delta', {
                sessionId: 's-a',
                messageId: 'ma',
                delta: { type: 'text_delta', text: 'Msg from alpha' },
            });
            expect(await waitForText(page, 'Msg from alpha')).toBe(true);

            eventBus.emit('session', 'start', { sessionId: 's-b', nodeId: 'beta', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'beta', 5000);
            eventBus.emit('session', 'message_delta', {
                sessionId: 's-b',
                messageId: 'mb',
                delta: { type: 'text_delta', text: 'Msg from beta' },
            });
            expect(await waitForText(page, 'Msg from beta')).toBe(true);

            // Click alpha's session leaf in sidebar on .bp6-tree-node-content
            await page.waitForFunction(
                () => {
                    const contents = document.querySelectorAll('.bp6-tree-node-content');
                    for (const el of contents) {
                        const label = el.querySelector('.bp6-tree-node-label');
                        if (label && label.textContent.includes('R1-worker')) {
                            const treeNode = el.closest('.bp6-tree-node');
                            const parentLi = treeNode?.parentElement?.closest('.bp6-tree-node');
                            const parentLabel = parentLi?.querySelector('.bp6-tree-node-label');
                            if (parentLabel && parentLabel.textContent.includes('alpha')) {
                                el.click();
                                return true;
                            }
                        }
                    }
                    return false;
                },
                { timeout: 5000 },
            );

            // Alpha's message should now be visible, beta's hidden
            expect(await waitForText(page, 'Msg from alpha')).toBe(true);
            const betaShown = await page.evaluate(() => document.body.textContent.includes('Msg from beta'));
            expect(betaShown).toBe(false);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 18. DAG View collapse/expand ───────────────────────────────────────────

    test('click DAG View header collapses then expands the diagram', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'daggy', task: 'Test', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'DAG View', 5000);
            expect(await waitForText(page, 'daggy')).toBe(true);

            // Collapse by clicking the DAG View header
            await page.evaluate(() => {
                const header = document.querySelector('[role="button"][aria-expanded]');
                if (header && header.textContent.includes('DAG View')) header.click();
            });
            // After collapse, node name should not be in body (Collapse hides it)
            const hidden = await page
                .waitForFunction(() => !document.body.textContent.includes('daggy'), { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            expect(hidden).toBe(true);

            // Expand again — header is still visible
            await page.evaluate(() => {
                const header = document.querySelector('[role="button"][aria-expanded]');
                if (header && header.textContent.includes('DAG View')) header.click();
            });
            // After expand, the DAG View header should still be there
            expect(await waitForText(page, 'DAG View')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 19. DAG SVG node has onclick handler ───────────────────────────────────

    test('DAG SVG g elements have onclick handlers attached', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'L',
                nodes: [
                    { id: 'node-a', task: 'Task A', review_criteria: [] },
                    { id: 'node-b', task: 'Task B', review_criteria: [] },
                ],
                originalTask: 'dag click',
            });
            await waitForText(page, 'node-a', 5000);

            // Each SVG g element containing node text should have onclick handler
            const handlers = await page.evaluate(() => {
                const allG = document.querySelectorAll('g');
                const result = [];
                for (const g of allG) {
                    if (g.textContent.includes('node-a') || g.textContent.includes('node-b')) {
                        result.push({
                            id: g.textContent.replace(/[()\[\]]/g, '').trim(),
                            hasHandler: typeof g.onclick === 'function',
                        });
                    }
                }
                return result;
            });

            // Both nodes should have onclick handlers
            const nodeA = handlers.find((h) => h.id === 'node-a');
            const nodeB = handlers.find((h) => h.id === 'node-b');
            expect(nodeA?.hasHandler).toBe(true);
            expect(nodeB?.hasHandler).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 20. Abort button ──────────────────────────────────────────────────────

    test('abort button click resets UI to Welcome view', async () => {
        const page = await createPage();
        try {
            expect(await page.evaluate(() => !!document.querySelector('[aria-label="Abort Squad"]'))).toBe(false);

            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            await page.waitForSelector('[aria-label="Abort Squad"]', { timeout: 5000 });

            await page.evaluate(() => {
                document.querySelector('[aria-label="Abort Squad"]')?.click();
            });

            expect(await waitForText(page, 'Welcome to Squad-Tau')).toBe(true);
            expect(await page.evaluate(() => !!document.querySelector('[aria-label="Abort Squad"]'))).toBe(false);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 21. Send user message via keyboard ─────────────────────────────────────

    test('type message and press Enter shows optimistic message', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            const textarea = await page.waitForSelector('textarea', { timeout: 5000 });
            await textarea.focus();
            await page.keyboard.type('Hello from test user');
            await page.keyboard.press('Enter');

            expect(await waitForText(page, 'Hello from test user')).toBe(true);
            const cleared = await page.evaluate(() => document.querySelector('textarea')?.value || '');
            expect(cleared).toBe('');
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 22. Model Pool: add a slot via form ───────────────────────────────────

    test('model_pool:changed event renders slots in drawer table', async () => {
        const page = await createPage();
        try {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find((b) =>
                    b.textContent.includes('Configure Model Pool'),
                );
                if (btn) btn.click();
            });
            await waitForText(page, 'Model Pool Configuration', 5000);

            // Simulate the server sending a model pool update
            eventBus.emit('model_pool', 'changed', {
                slots: [
                    {
                        provider: 'anthropic',
                        modelId: 'claude-3-5-sonnet',
                        role: 'worker',
                        thinkingLevel: 'none',
                        inUse: false,
                    },
                    { provider: 'openai', modelId: 'gpt-4', role: 'reviewer', thinkingLevel: 'medium', inUse: false },
                ],
            });

            // Wait for slots to appear in the table
            expect(await waitForText(page, 'anthropic')).toBe(true);
            expect(await waitForText(page, 'claude-3-5-sonnet')).toBe(true);
            expect(await waitForText(page, 'openai')).toBe(true);
            expect(await waitForText(page, 'gpt-4')).toBe(true);
            expect(await waitForText(page, 'reviewer')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 23. Error banner dismiss ───────────────────────────────────────────────

    test('dismiss error banner via X button', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);

            // Create failed node state then complete to trigger error banner
            eventBus.emit('squad', 'node_state', {
                nodeId: 'n1',
                status: 'failed',
                retryCount: 0,
                summary: 'Error summary',
            });
            eventBus.emit('squad', 'complete', {
                results: [{ id: 'n1', status: 'failed', summary: 'Error summary', affectedFiles: [] }],
                durationMs: 1000,
            });
            await waitForText(page, 'Squad Failed', 5000);

            // Click the dismiss button via aria-label
            await page.evaluate(() => {
                const dismissBtn = document.querySelector('[aria-label="Dismiss"]');
                if (dismissBtn) dismissBtn.click();
            });

            // After dismiss, error banner should be gone
            const bannerGone = await page
                .waitForFunction(() => !document.body.textContent.includes('Squad Failed'), { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            expect(bannerGone).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 24. Thinking block collapse/expand ──────────────────────────────────────

    test('click Thinking header collapses and expands the block', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            // Send thinking delta
            eventBus.emit('session', 'message_delta', {
                sessionId: 's1',
                messageId: 'msg-think',
                delta: { type: 'thinking_delta', text: 'Thinking content here' },
            });
            await waitForText(page, 'Thinking content here', 5000);

            // Collapse by clicking the Thinking header
            await page.evaluate(() => {
                const headers = Array.from(document.querySelectorAll('[role="button"]'));
                const thinkHeader = headers.find((h) => h.textContent.includes('Thinking'));
                if (thinkHeader) thinkHeader.click();
            });

            // After collapse, thinking content should be hidden
            const hidden = await page
                .waitForFunction(() => !document.body.textContent.includes('Thinking content here'), { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            expect(hidden).toBe(true);

            // Expand again
            await page.evaluate(() => {
                const headers = Array.from(document.querySelectorAll('[role="button"]'));
                const thinkHeader = headers.find((h) => h.textContent.includes('Thinking'));
                if (thinkHeader) thinkHeader.click();
            });
            expect(await waitForText(page, 'Thinking content here')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 25. Tool call header expand/collapse ────────────────────────────────────

    test('click tool call header collapses and expands tool details', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            eventBus.emit('session', 'tool_call', {
                sessionId: 's1',
                toolName: 'test_tool',
                toolId: 't1',
                params: { key: 'value' },
            });
            await waitForText(page, 'test_tool', 5000);

            // Tool name should be visible; collapse by clicking the header
            await page.evaluate(() => {
                const headers = Array.from(document.querySelectorAll('[role="button"]'));
                const toolHeader = headers.find((h) => h.textContent.includes('test_tool'));
                if (toolHeader) toolHeader.click();
            });

            // After collapse, parameters should be hidden
            const hidden = await page
                .waitForFunction(() => !document.body.textContent.includes('Parameters'), { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            expect(hidden).toBe(true);

            // Expand again
            await page.evaluate(() => {
                const headers = Array.from(document.querySelectorAll('[role="button"]'));
                const toolHeader = headers.find((h) => h.textContent.includes('test_tool'));
                if (toolHeader) toolHeader.click();
            });
            expect(await waitForText(page, 'Parameters')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 26. Back-and-forth session switching ────────────────────────────────────

    test('switch between two sessions back and forth via sidebar', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'L',
                nodes: [
                    { id: 'node-x', task: 'X', review_criteria: [] },
                    { id: 'node-y', task: 'Y', review_criteria: [] },
                ],
                originalTask: 'switch',
            });
            await waitForText(page, 'node-x', 5000);

            eventBus.emit('session', 'start', { sessionId: 's-x', nodeId: 'node-x', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);
            eventBus.emit('session', 'message_delta', {
                sessionId: 's-x',
                messageId: 'mx',
                delta: { type: 'text_delta', text: 'Content X' },
            });
            expect(await waitForText(page, 'Content X')).toBe(true);

            eventBus.emit('session', 'start', { sessionId: 's-y', nodeId: 'node-y', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'node-y', 5000);
            eventBus.emit('session', 'message_delta', {
                sessionId: 's-y',
                messageId: 'my',
                delta: { type: 'text_delta', text: 'Content Y' },
            });
            expect(await waitForText(page, 'Content Y')).toBe(true);

            // Click X's session leaf to switch back (sets locked=true, prevents auto-revert)
            await page.waitForFunction(
                () => {
                    const contents = document.querySelectorAll('.bp6-tree-node-content');
                    for (const el of contents) {
                        const label = el.querySelector('.bp6-tree-node-label');
                        if (label && label.textContent.includes('R1-worker')) {
                            const treeNode = el.closest('.bp6-tree-node');
                            const parentLi = treeNode?.parentElement?.closest('.bp6-tree-node');
                            const parentLabel = parentLi?.querySelector('.bp6-tree-node-label');
                            if (parentLabel && parentLabel.textContent.includes('node-x')) {
                                el.click();
                                return true;
                            }
                        }
                    }
                    return false;
                },
                { timeout: 5000 },
            );
            expect(await waitForText(page, 'Content X')).toBe(true);

            // Click Y's session leaf to switch again
            await page.waitForFunction(
                () => {
                    const contents = document.querySelectorAll('.bp6-tree-node-content');
                    for (const el of contents) {
                        const label = el.querySelector('.bp6-tree-node-label');
                        if (label && label.textContent.includes('R1-worker')) {
                            const treeNode = el.closest('.bp6-tree-node');
                            const parentLi = treeNode?.parentElement?.closest('.bp6-tree-node');
                            const parentLabel = parentLi?.querySelector('.bp6-tree-node-label');
                            if (parentLabel && parentLabel.textContent.includes('node-y')) {
                                el.click();
                                return true;
                            }
                        }
                    }
                    return false;
                },
                { timeout: 5000 },
            );
            expect(await waitForText(page, 'Content Y')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 27. Header DAG toggle button ────────────────────────────────────────────

    test('header DAG toggle button shows and hides the DAG section', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'dag-node', task: 'Test', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'DAG View', 5000);
            expect(await waitForText(page, 'dag-node')).toBe(true);

            // Click header DAG toggle button via aria-label
            await page.evaluate(() => {
                const btn = document.querySelector('[aria-label="Toggle DAG View"]');
                if (btn) btn.click();
            });

            // DAG View should be hidden
            const hidden = await page
                .waitForFunction(() => !document.body.textContent.includes('DAG View'), { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            expect(hidden).toBe(true);

            // Click again to show
            await page.evaluate(() => {
                const btn = document.querySelector('[aria-label="Toggle DAG View"]');
                if (btn) btn.click();
            });
            expect(await waitForText(page, 'DAG View')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 28. Session tree parent collapse ────────────────────────────────────────

    test('click sidebar tree parent collapses child sessions', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'parent-node', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'parent-node', 5000);
            eventBus.emit('session', 'start', {
                sessionId: 's1',
                nodeId: 'parent-node',
                phase: 'worker',
                retryCount: 0,
            });
            await waitForText(page, 'R1-worker', 5000);

            // Click the parent node's caret to collapse children
            await page.evaluate(() => {
                const caret = document.querySelector('.bp6-tree-node-caret');
                if (caret) caret.click();
            });

            // After collapse, the child label should be hidden
            const hidden = await page
                .waitForFunction(() => !document.body.textContent.includes('R1-worker'), { timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            expect(hidden).toBe(true);

            // Expand again
            await page.evaluate(() => {
                const caret = document.querySelector('.bp6-tree-node-caret');
                if (caret) caret.click();
            });
            expect(await waitForText(page, 'R1-worker')).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);

    // ── 29. Input disabled after session end ────────────────────────────────────

    test('textarea is disabled after session ends', async () => {
        const page = await createPage();
        try {
            eventBus.emit('squad', 'init', {
                mode: 'M',
                nodes: [{ id: 'n1', task: 'T', review_criteria: [] }],
                originalTask: 'test',
            });
            await waitForText(page, 'n1', 5000);
            eventBus.emit('session', 'start', { sessionId: 's1', nodeId: 'n1', phase: 'worker', retryCount: 0 });
            await waitForText(page, 'R1-worker', 5000);

            // Verify input is initially enabled
            const enabled = await page.evaluate(() => !document.querySelector('textarea')?.disabled);
            expect(enabled).toBe(true);

            // End the session
            eventBus.emit('session', 'end', { sessionId: 's1', reason: 'completed' });

            // Wait for textarea to become disabled with correct placeholder
            const disabled = await page
                .waitForFunction(() => document.querySelector('textarea')?.disabled === true, { timeout: 8000 })
                .then(() => true)
                .catch(() => false);
            expect(disabled).toBe(true);
        } finally {
            await page.close();
        }
    }, 30000);
});
