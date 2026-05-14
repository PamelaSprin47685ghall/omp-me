import fs from 'fs';
import path from 'path';
import { describe, test, beforeAll, afterAll, expect } from 'bun:test';
import { startServer, stopServer } from '../../server/server-lifecycle.js';
import { register, unregister } from '../../server/session-registry.js';
import { setupBrowser, teardownBrowser, waitForAppWebSocket } from '../helpers/puppeteer-setup.js';

const SHOT_DIR = `/tmp/squad-ui-full-flow-${Date.now()}-${process.pid}`;
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function capture(page, name) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
    return name;
}

function emitSquadInit(eb, mode, nodes, task) {
    eb.emit('squad', 'init', { mode, nodes, originalTask: task });
}

function emitSessionStart(eb, sid, nodeId, phase, retryCount = 0) {
    eb.emit('session', 'start', { sessionId: sid, nodeId, phase, retryCount });
}

describe('UI Full Flow', () => {
    let browser;
    let page;
    let port;
    let eb;
    let sessionId;

    beforeAll(async () => {
        const server = await startServer();
        port = server.port;
        eb = server.eventBus;
        const launched = await setupBrowser();
        browser = launched.browser;
        page = launched.page;
        sessionId = `flow-${Date.now()}`;
        register(sessionId, {
            status: 'authoring',
            sendUserMessage: async (text) => {
                eb.emit('session', 'message', {
                    sessionId,
                    role: 'user',
                    content: [{ type: 'text', text }],
                    messageId: `usr-${Date.now()}`,
                });
            },
        });
        await page.setViewport({ width: 1600, height: 1200 });
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppWebSocket(page, 20000);
    }, 60000);

    afterAll(async () => {
        unregister(sessionId);
        await teardownBrowser(browser);
        await stopServer();
    }, 60000);

    /**
     * Click a sidebar session leaf node by matching its inner text (e.g. "R1 worker")
     */
    async function clickSidebarSession(page, labelText) {
        await page.evaluate((text) => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const node = items.find((el) => el.textContent && el.textContent.trim().startsWith(text));
            if (node) node.click();
        }, labelText);
    }

    test('01 welcome page', async () => {
        expect(await page.$eval('[data-app-title]', (el) => el.textContent)).toBe('Squad-Tau');
        expect(await page.$eval('[data-header-connection]', (el) => el.textContent)).toContain('Connected');
        await capture(page, '01-welcome');
    }, 10000);

    test('02 model pool drawer empty and filled', async () => {
        // Click the Model Pool button (button has aria-label="Model Pool", textContent is empty due to SVG icon)
        await page.evaluate(() => {
            const btn = document.querySelector('button[aria-label="Model Pool"]');
            if (btn) btn.click();
        });
        // Wait for the drawer to open (header text always visible)
        await page.waitForFunction(() => document.body.innerText.includes('Model Pool Configuration'), {
            timeout: 5000,
        });
        await capture(page, '02a-drawer-empty');

        eb.emit('model_pool', 'snapshot', {
            slots: [
                {
                    provider: 'anthropic',
                    modelId: 'claude-3-5-sonnet',
                    role: 'worker',
                    thinkingLevel: 'medium',
                    inUse: true,
                },
                { provider: 'openai', modelId: 'gpt-4.1', role: 'reviewer', thinkingLevel: 'low', inUse: false },
            ],
        });
        await page.waitForFunction(
            () =>
                document.querySelectorAll('[data-part="row"]').length >= 2 ||
                document.querySelectorAll('tbody tr').length >= 2 ||
                document.body.innerText.includes('claude-3-5-sonnet'),
            {
                timeout: 5000,
            },
        );
        await capture(page, '02b-drawer-filled');

        const rows = [...(await page.$$('tbody tr'))];
        expect(rows.length).toBeGreaterThanOrEqual(2);
        await page.keyboard.press('Escape');
    }, 15000);

    test('03 dag single node and tree', async () => {
        emitSquadInit(
            eb,
            'M',
            [{ id: 'flow-node', task: 'Build a calculator', review_criteria: ['works'] }],
            'build calculator',
        );
        emitSessionStart(eb, sessionId, 'flow-node', 'worker', 0);

        await page.waitForFunction(() => document.body.innerText.includes('flow-node'), { timeout: 5000 });
        await capture(page, '03-dag-and-tree');
    }, 10000);

    test('04 session input and user message', async () => {
        await page.evaluate(() => window.__selectLatestSession?.());
        await page.waitForFunction(() => document.querySelector('textarea') !== null, { timeout: 5000 });
        await capture(page, '04a-session-input');

        const textarea = await page.waitForSelector('textarea', { timeout: 5000 });
        await textarea.focus();
        await page.keyboard.type('Please add keyboard support');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('textarea')?.value === '', { timeout: 5000 });
        await capture(page, '04b-user-message');
    }, 15000);

    test('05 thinking block collapsed and expanded', async () => {
        // Ensure the correct session is active before emitting deltas
        await page.evaluate((sid) => window.__setActiveSessionId?.(sid), sessionId);

        eb.emit('session', 'message_delta', {
            sessionId,
            messageId: 'assistant-1',
            delta: { type: 'thinking_delta', text: 'Planning the implementation...' },
        });
        eb.emit('session', 'message_delta', {
            sessionId,
            messageId: 'assistant-1',
            delta: { type: 'text_delta', text: 'I will split the work into small modules.' },
        });

        await page.waitForFunction(() => document.body.innerText.includes('Thinking'), { timeout: 5000 });
        await capture(page, '05a-thinking-collapsed');

        // Click on the Thinking header to expand (role="button" containing "Thinking")
        await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('[role="button"]')];
            const thinkHeader = buttons.find((b) => b.textContent.includes('Thinking'));
            if (thinkHeader) thinkHeader.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Planning the implementation...'), {
            timeout: 5000,
        });
        await capture(page, '05b-thinking-expanded');
    }, 15000);

    test('06 tool call collapsed expanded and done', async () => {
        eb.emit('session', 'tool_call', {
            sessionId,
            toolName: 'read',
            toolId: 'tool-1',
            params: { path: 'client/App.jsx' },
        });
        await page.waitForFunction(() => document.body.innerText.includes('read'), { timeout: 5000 });
        await capture(page, '06a-tool-collapsed');

        // Click the tool call header (role="button" containing "read")
        await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('[role="button"]')];
            const toolHeader = buttons.find((b) => b.textContent.includes('read') && b.textContent.includes('client'));
            if (toolHeader) toolHeader.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('client/App.jsx'), { timeout: 5000 });
        await capture(page, '06b-tool-expanded');

        eb.emit('session', 'tool_result', {
            sessionId,
            toolId: 'tool-1',
            result: { content: [{ type: 'text', text: 'ok' }] },
            isError: false,
        });
        await page.waitForFunction(() => document.body.innerText.includes('done'), { timeout: 5000 });
        await capture(page, '06c-tool-done');
    }, 15000);

    test('07 failed banner', async () => {
        // Click DAG Overview to see the DAG view
        await page.evaluate(() => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const dag = items.find((el) => el.textContent && el.textContent.includes('DAG Overview'));
            dag?.click();
        });

        eb.emit('squad', 'node_state', {
            nodeId: 'flow-node',
            status: 'failed',
            retryCount: 1,
            summary: 'Calculator crashed',
        });
        await page.waitForFunction(() => document.body.innerText.includes('Calculator crashed'), { timeout: 5000 });
        await capture(page, '07-failed-banner');
    }, 10000);

    test('08 success banner', async () => {
        eb.emit('squad', 'node_state', {
            nodeId: 'flow-node',
            status: 'approved',
            retryCount: 0,
            summary: 'Calculator finished',
        });
        eb.emit('squad', 'complete', {
            results: [
                { id: 'flow-node', status: 'approved', summary: 'Calculator finished', affectedFiles: ['app.js'] },
            ],
            durationMs: 1200,
        });
        await page.waitForFunction(() => document.body.innerText.includes('Squad completed successfully'), {
            timeout: 5000,
        });
        await capture(page, '08-success-banner');
    }, 10000);

    test('09 dag status colors on multi-node', async () => {
        emitSquadInit(
            eb,
            'L',
            [
                { id: 'A', task: 'a', review_criteria: ['ok'], depends_on: [] },
                { id: 'B', task: 'b', review_criteria: ['ok'], depends_on: [] },
                { id: 'C', task: 'c', review_criteria: ['ok'], depends_on: ['A', 'B'] },
            ],
            'diamond',
        );
        eb.emit('squad', 'node_state', { nodeId: 'A', status: 'approved', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'B', status: 'failed', retryCount: 0 });
        eb.emit('squad', 'node_state', { nodeId: 'C', status: 'blocked', retryCount: 0 });
        await page.waitForFunction(() => document.body.innerText.includes('blocked'), { timeout: 5000 });
        await capture(page, '09-dag-status-colors');
    }, 10000);

    test('10 sidebar with sessions and outer review', async () => {
        emitSessionStart(eb, 's-a1', 'A', 'worker', 0);
        emitSessionStart(eb, 's-a2', 'A', 'reviewer', 1);
        emitSessionStart(eb, 's-b1', 'B', 'worker', 0);
        eb.emit('session', 'start', { sessionId: 's-outer', nodeId: null, phase: 'outer_review', retryCount: 0 });
        await page.waitForFunction(
            () => document.body.innerText.includes('R2 reviewer') && document.body.innerText.includes('outer review'),
            { timeout: 5000 },
        );
        await capture(page, '10-sidebar-sessions');
    }, 10000);

    test('11 tool error state', async () => {
        emitSquadInit(eb, 'M', [{ id: 'ErrN', task: 'err', review_criteria: ['ok'] }], 'err');
        emitSessionStart(eb, 's-err', 'ErrN', 'worker', 2);
        await page.waitForFunction(() => document.body.innerText.includes('R3 worker'), { timeout: 5000 });
        await clickSidebarSession(page, 'R3 worker');

        eb.emit('session', 'tool_call', {
            sessionId: 's-err',
            toolName: 'bash',
            toolId: 'tc-err',
            params: { command: 'rm -rf /' },
        });
        eb.emit('session', 'tool_result', {
            sessionId: 's-err',
            toolId: 'tc-err',
            result: { error: 'Permission denied' },
            isError: true,
        });
        await page.waitForFunction(() => document.body.innerText.includes('error'), { timeout: 5000 });
        await capture(page, '11-tool-error');
    }, 10000);

    test('12 long message does not overflow', async () => {
        await page.evaluate(() => window.__selectLatestSession?.());
        const longText = 'A'.repeat(800);
        eb.emit('session', 'message', {
            sessionId: 's-err',
            role: 'user',
            content: [{ type: 'text', text: longText }],
            messageId: 'ml1',
        });
        await page.waitForFunction(() => document.body.innerText.includes('AAAA'), { timeout: 5000 });
        const msgText = await page.$eval('[data-user-msg]', (el) => el.textContent);
        expect(msgText).toContain(longText.slice(0, 50));
        await capture(page, '12-long-message');
    }, 10000);

    test('13 model pool drawer edit mode', async () => {
        // Click Model Pool button
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const btn = btns.find(
                (b) =>
                    b.getAttribute('aria-label') === 'Model Pool' ||
                    b.textContent.includes('Model Pool') ||
                    b.textContent.includes('Configure Model Pool'),
            );
            if (btn) btn.click();
        });
        // Wait for the drawer to open
        await page.waitForFunction(() => document.body.innerText.includes('Model Pool Configuration'), {
            timeout: 5000,
        });

        eb.emit('model_pool', 'snapshot', {
            slots: [
                {
                    slotId: 'slot-1',
                    provider: 'anthropic',
                    modelId: 'claude-3-5-sonnet-20241022',
                    role: 'worker',
                    thinkingLevel: 'medium',
                    inUse: true,
                },
                {
                    slotId: 'slot-2',
                    provider: 'openai',
                    modelId: 'gpt-4.1',
                    role: 'reviewer',
                    thinkingLevel: 'low',
                    inUse: false,
                },
                {
                    slotId: 'slot-3',
                    provider: 'google',
                    modelId: 'gemini-1.5-pro',
                    role: 'worker',
                    thinkingLevel: 'high',
                    inUse: false,
                },
            ],
        });
        await page.waitForFunction(() => document.body.innerText.includes('gemini'), { timeout: 5000 });

        // Click edit on first slot row
        await page.evaluate(() => {
            const rows = [...document.querySelectorAll('tbody tr')];
            rows[0]?.querySelector('button[aria-label="Edit slot"]')?.click();
        });
        await page.waitForFunction(
            () =>
                document.querySelector('select') !== null ||
                document.querySelector('[data-part="native-select"]') !== null,
            { timeout: 5000 },
        );
        await capture(page, '13-drawer-edit');
        await page.keyboard.press('Escape');
    }, 15000);

    test('14 dark mode welcome and session', async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await waitForAppWebSocket(page, 10000);
        await page.waitForFunction(
            () =>
                document.documentElement.classList.contains('dark') ||
                window.matchMedia('(prefers-color-scheme: dark)').matches,
            { timeout: 5000 },
        );
        await capture(page, '14a-dark-welcome');

        emitSquadInit(eb, 'M', [{ id: 'DarkN', task: 'd', review_criteria: ['ok'] }], 'dark');
        emitSessionStart(eb, 's-dark', 'DarkN', 'worker', 0);
        eb.emit('session', 'message', {
            sessionId: 's-dark',
            role: 'user',
            content: [{ type: 'text', text: 'Dark mode message' }],
            messageId: 'md1',
        });
        await page.waitForFunction(() => document.body.innerText.includes('R1 worker'), { timeout: 5000 });
        await clickSidebarSession(page, 'R1 worker');
        await page.waitForFunction(() => document.body.innerText.includes('Dark mode message'), { timeout: 5000 });
        await capture(page, '14b-dark-session');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    }, 15000);

    test('15 reviewer and outer review callouts', async () => {
        // Ensure WebSocket is still connected after test 14's page.goto
        await waitForAppWebSocket(page, 5000);
        emitSquadInit(eb, 'M', [{ id: 'RevN', task: 'review', review_criteria: ['ok'] }], 'review');
        emitSessionStart(eb, 's-rev', 'RevN', 'reviewer', 0);
        eb.emit('session', 'message', {
            sessionId: 's-rev',
            role: 'assistant',
            content: [{ type: 'text', text: 'Reviewing the architecture.' }],
            messageId: 'mr1',
        });
        await capture(page, '15a-before-wait');

        // Check body text content before the assertion
        const bodyPreview = await page.evaluate(() => document.body.innerText.substring(0, 2000));
        console.log('[15] body text:', JSON.stringify(bodyPreview));

        await page.waitForFunction(() => document.body.innerText.includes('R1 reviewer'), { timeout: 8000 });
        await clickSidebarSession(page, 'R1 reviewer');
        await page.waitForFunction(() => document.body.innerText.includes('Reviewing the architecture'), {
            timeout: 5000,
        });
        await capture(page, '15a-reviewer-callout');

        emitSquadInit(eb, 'M', [{ id: 'OutN', task: 'out', review_criteria: ['ok'] }], 'outer');
        eb.emit('session', 'start', { sessionId: 's-outer2', nodeId: null, phase: 'outer_review', retryCount: 0 });
        eb.emit('session', 'message', {
            sessionId: 's-outer2',
            role: 'assistant',
            content: [{ type: 'text', text: 'Outer review complete.' }],
            messageId: 'mo1',
        });
        await page.waitForFunction(() => document.body.innerText.includes('outer review'), { timeout: 8000 });
        await clickSidebarSession(page, 'R1 outer review');
        await page.waitForFunction(() => document.body.innerText.includes('Outer review complete'), { timeout: 5000 });
        await capture(page, '15b-outer-review-callout');
    }, 25000);

    test('16 abort returns to welcome', async () => {
        eb.emit('squad', 'abort', { reason: 'test' });
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 5000 });
        await capture(page, '16-abort-welcome');
    }, 10000);
});
