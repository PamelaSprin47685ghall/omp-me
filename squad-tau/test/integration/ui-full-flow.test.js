/**
 * Dehydrated UI Full Flow — visual regression gallery (v5).
 */
import fs from 'fs';
import path from 'path';
import { describe, test, beforeAll, afterAll, expect } from 'bun:test';
import { T } from '../helpers/timeout.test.js';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import { setupBrowser, teardownBrowser, clickSidebarNode } from '../helpers/puppeteer-setup.js';

const SHOT_DIR = `/tmp/squad-ui-full-flow-${Date.now()}-${process.pid}`;
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function capture(page, name) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
    return name;
}

function inject(page, events) {
    return page.evaluate(async (evts) => {
        const es = window.__es;
        const started = new Set();
        const yieldToReact = () => new Promise((resolve) => setTimeout(resolve, 15));

        for (const e of evts) {
            if (e.type === 'session:message_delta' || e.type === 'session:thinking_delta') {
                const { sessionId, messageId } = e.payload;
                const key = `${sessionId}:${messageId}`;

                if (!started.has(key)) {
                    started.add(key);
                    es.dispatch('entity:created', {
                        entityType: 'message',
                        entityId: messageId,
                        sessionId,
                        role: 'assistant',
                    });

                    // [修复] 取消恶心的 while 轮询，直接连让 3 帧给 React 调度器
                    await yieldToReact();
                    await yieldToReact();
                    await yieldToReact();
                }

                document.dispatchEvent(
                    new CustomEvent('delta', {
                        detail: {
                            messageId,
                            sessionId,
                            type: e.type === 'session:thinking_delta' ? 'thinking' : 'text',
                            text: e.payload.delta?.text || '',
                        },
                    }),
                );
                await new Promise((r) => setTimeout(r, 0));
                continue;
            }

            if (e.type === 'session:message') {
                const { sessionId, messageId, role, content } = e.payload;
                if (!es.getState().messages[messageId]) {
                    const blocks = content || [];
                    const text = Array.isArray(blocks) && blocks[0]?.type === 'text' ? blocks[0].text : undefined;
                    es.dispatch('entity:created', {
                        entityType: 'message',
                        entityId: messageId,
                        sessionId,
                        role,
                        staticContent: role === 'user' ? text : undefined,
                    });
                    await yieldToReact();
                }
                if (role !== 'user') {
                    es.dispatch('entity:finalized', {
                        entityType: 'message',
                        entityId: messageId,
                        sessionId,
                    });
                    const blocks = content || [];
                    const text = Array.isArray(blocks) && blocks[0]?.type === 'text' ? blocks[0].text : undefined;
                    document.dispatchEvent(
                        new CustomEvent('stream:end', {
                            detail: { messageId, sessionId, text },
                        }),
                    );
                }
                await yieldToReact();
                continue;
            }

            if (e.type === 'session:message_start') {
                es.dispatch('entity:created', {
                    entityType: 'message',
                    entityId: e.payload.messageId,
                    sessionId: e.payload.sessionId,
                    role: e.payload.role || 'assistant',
                });
                await yieldToReact();
                continue;
            }

            es.dispatch(e.type, e.payload, e.seq);
            await yieldToReact();
        }
    }, events);
}

function reset(page) {
    return page.evaluate(() => {
        window.__es.reset();
    });
}

describe('UI Full Flow', () => {
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
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: T });
        await page.waitForSelector('[data-app-title]', { timeout: T });
    }, 60000);

    afterAll(async () => {
        await teardownBrowser(browser);
        await stopViteOnly();
    }, 60000);

    test('01 welcome page', async () => {
        expect(await page.$eval('[data-app-title]', (el) => el.textContent)).toBe('Squad-Tau');
        await capture(page, '01-welcome');
    }, 10000);

    test('02 model pool drawer', async () => {
        await page.evaluate(() => {
            const btn = document.querySelector('button[aria-label="Runtime Metrics"]');
            if (btn) btn.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Runtime Metrics'), { timeout: T });
        await capture(page, '02a-drawer');

        await inject(page, [{ type: 'model_pool:snapshot', payload: { maxWorkers: 5 } }]);
        await page.waitForFunction(() => document.body.innerText.includes('5'), { timeout: T });
        await capture(page, '02b-drawer-updated');
        await page.keyboard.press('Escape');
    }, 15000);

    test('03 dag single node and tree', async () => {
        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'M',
                    nodes: [{ id: 'flow-node', task: 'Build a calculator', review_criteria: ['works'] }],
                    originalTask: 'build calculator',
                },
            },
            {
                type: 'session:start',
                payload: { sessionId: 'flow-s1', nodeId: 'flow-node', phase: 'authoring', retryCount: 0 },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('flow-node'), { timeout: T });
        await capture(page, '03-dag-and-tree');
    }, 10000);

    test('04 session input and user message', async () => {
        await clickSidebarNode(page, 'R1 authoring');
        await page.waitForFunction(() => document.querySelector('textarea') !== null, { timeout: T });
        await capture(page, '04a-session-input');

        const textarea = await page.waitForSelector('textarea', { timeout: T });
        await textarea.focus();
        await page.keyboard.type('Please add keyboard support');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('textarea')?.value === '', { timeout: T });
        await capture(page, '04b-user-message');
    }, 15000);

    test('05 thinking block open and collapsible', async () => {
        await clickSidebarNode(page, 'flow-node');
        await clickSidebarNode(page, 'R1 authoring');

        await inject(page, [
            {
                type: 'session:message_delta',
                payload: {
                    sessionId: 'flow-s1',
                    messageId: 'assistant-1',
                    delta: { type: 'thinking_delta', text: 'Planning the implementation...' },
                },
            },
            {
                type: 'session:message_delta',
                payload: {
                    sessionId: 'flow-s1',
                    messageId: 'assistant-1',
                    delta: { type: 'text_delta', text: 'I will split the work into small modules.' },
                },
            },
        ]);

        await page.waitForFunction(
            () => {
                const el = document.querySelector('agent-message');
                if (!el) return false;
                const root = el.shadowRoot;
                if (!root) return false;
                const details = root.querySelector('.thinking-section details');
                return details && details.open && el.textContent.includes('Planning');
            },
            { timeout: T },
        );
        await capture(page, '05a-thinking-open');

        await page.evaluate(() => {
            const el = document.querySelector('agent-message');
            if (!el) return;
            const root = el.shadowRoot;
            if (!root) return;
            const summary = root.querySelector('.thinking-summary');
            if (summary) summary.click();
        });
        await page.waitForFunction(
            () => {
                const el = document.querySelector('agent-message');
                if (!el) return false;
                const root = el.shadowRoot;
                if (!root) return false;
                const details = root.querySelector('.thinking-section details');
                return details && !details.open;
            },
            { timeout: T },
        );
        await capture(page, '05b-thinking-collapsed');
    }, 15000);

    test('06 tool call collapsed expanded and done', async () => {
        await inject(page, [
            {
                type: 'session:message_start',
                payload: { sessionId: 'flow-s1', messageId: 'assistant-2', role: 'assistant' },
            },
            {
                type: 'session:tool_call',
                payload: {
                    sessionId: 'flow-s1',
                    toolName: 'read',
                    toolId: 'tool-1',
                    params: { path: 'client/App.jsx' },
                    messageId: 'assistant-2',
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('read'), { timeout: T });
        await capture(page, '06a-tool-collapsed');

        await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('[role="button"]')];
            const toolHeader = buttons.find((b) => b.textContent.includes('read') && b.textContent.includes('client'));
            if (toolHeader) toolHeader.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('client/App.jsx'), { timeout: T });
        await capture(page, '06b-tool-expanded');

        await inject(page, [
            {
                type: 'session:tool_result',
                payload: {
                    sessionId: 'flow-s1',
                    toolId: 'tool-1',
                    result: { content: [{ type: 'text', text: 'ok' }] },
                    isError: false,
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('done'), { timeout: T });
        await capture(page, '06c-tool-done');
    }, 15000);

    test('07 failed banner', async () => {
        await page.evaluate(() => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const dag = items.find((el) => el.textContent && el.textContent.includes('DAG Overview'));
            dag?.click();
        });

        await inject(page, [
            {
                type: 'squad:node_state',
                payload: { nodeId: 'flow-node', status: 'failed', retryCount: 1, summary: 'Calculator crashed' },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('Calculator crashed'), { timeout: T });
        await capture(page, '07-failed-banner');
    }, 10000);

    test('08 success banner', async () => {
        await inject(page, [
            {
                type: 'squad:node_state',
                payload: { nodeId: 'flow-node', status: 'approved', retryCount: 0, summary: 'Calculator finished' },
            },
            {
                type: 'squad:complete',
                payload: {
                    results: [
                        {
                            id: 'flow-node',
                            status: 'approved',
                            summary: 'Calculator finished',
                            affectedFiles: ['app.js'],
                        },
                    ],
                    durationMs: 1200,
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('Squad completed successfully'), {
            timeout: T,
        });
        await capture(page, '08-success-banner');
    }, 10000);

    test('09 dag status colors on multi-node', async () => {
        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'L',
                    nodes: [
                        { id: 'A', task: 'a', review_criteria: ['ok'], depends_on: [] },
                        { id: 'B', task: 'b', review_criteria: ['ok'], depends_on: [] },
                        { id: 'C', task: 'c', review_criteria: ['ok'], depends_on: ['A', 'B'] },
                    ],
                    originalTask: 'diamond',
                },
            },
            { type: 'squad:node_state', payload: { nodeId: 'A', status: 'approved', retryCount: 0 } },
            { type: 'squad:node_state', payload: { nodeId: 'B', status: 'failed', retryCount: 0 } },
            { type: 'squad:node_state', payload: { nodeId: 'C', status: 'blocked', retryCount: 0 } },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('blocked'), { timeout: T });
        await capture(page, '09-dag-status-colors');
    }, 10000);

    test('10 sidebar with sessions and outer review', async () => {
        await inject(page, [
            { type: 'session:start', payload: { sessionId: 's-a1', nodeId: 'A', phase: 'authoring', retryCount: 0 } },
            { type: 'session:start', payload: { sessionId: 's-a2', nodeId: 'A', phase: 'reviewing', retryCount: 1 } },
            { type: 'session:start', payload: { sessionId: 's-b1', nodeId: 'B', phase: 'authoring', retryCount: 0 } },
            {
                type: 'session:start',
                payload: { sessionId: 's-outer', nodeId: null, phase: 'outer_review', retryCount: 0 },
            },
        ]);
        await page.waitForFunction(
            () => document.body.innerText.includes('R2 reviewing') && document.body.innerText.includes('outer review'),
            { timeout: T },
        );
        await capture(page, '10-sidebar-sessions');
    }, 10000);

    test('11 tool error state', async () => {
        await inject(page, [
            {
                type: 'session:start',
                payload: { sessionId: 's-err', nodeId: 'ErrN', phase: 'authoring', retryCount: 2 },
            },
        ]);

        await clickSidebarNode(page, 'R3 authoring');

        await inject(page, [
            {
                type: 'session:message_start',
                payload: { sessionId: 's-err', messageId: 'assistant-3', role: 'assistant' },
            },
            {
                type: 'session:tool_call',
                payload: {
                    sessionId: 's-err',
                    toolName: 'bash',
                    toolId: 'tc-err',
                    params: { command: 'rm -rf /' },
                    messageId: 'assistant-3',
                },
            },
            {
                type: 'session:tool_result',
                payload: {
                    sessionId: 's-err',
                    toolId: 'tc-err',
                    result: { error: 'Permission denied' },
                    isError: true,
                },
            },
        ]);

        await page.waitForFunction(() => document.body.innerText.includes('error'), { timeout: T });
        await capture(page, '11-tool-error');
    }, 15000);

    test('12 long message does not overflow', async () => {
        await clickSidebarNode(page, 'R3 authoring');

        const longText = 'A'.repeat(800);
        await inject(page, [
            {
                type: 'session:message',
                payload: {
                    sessionId: 's-err',
                    role: 'user',
                    content: [{ type: 'text', text: longText }],
                    messageId: 'ml1',
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('AAAA'), { timeout: T });
        const msgText = await page.$eval('[data-user-msg]', (el) => el.textContent);
        expect(msgText).toContain(longText.slice(0, 50));
        await capture(page, '12-long-message');
    }, 10000);

    test('13 model pool drawer maxWorkers', async () => {
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const btn = btns.find((b) => b.getAttribute('aria-label') === 'Runtime Metrics');
            if (btn) btn.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Runtime Metrics'), { timeout: T });
        await page.waitForFunction(() => document.body.innerText.includes('3'), { timeout: T });

        await inject(page, [{ type: 'model_pool:snapshot', payload: { maxWorkers: 10 } }]);
        await page.waitForFunction(() => document.body.innerText.includes('10'), { timeout: T });
        await capture(page, '13-drawer-maxWorkers');
        await page.keyboard.press('Escape');
    }, 15000);

    test('14 dark mode welcome and session', async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: T });
        await page.waitForSelector('[data-app-title]', { timeout: T });
        await page.waitForFunction(() => document.documentElement.classList.contains('dark'), { timeout: T });
        await capture(page, '14a-dark-welcome');

        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'M',
                    nodes: [{ id: 'DarkN', task: 'd', review_criteria: ['ok'] }],
                    originalTask: 'dark',
                },
            },
            {
                type: 'session:start',
                payload: { sessionId: 's-dark', nodeId: 'DarkN', phase: 'authoring', retryCount: 0 },
            },
            {
                type: 'session:message',
                payload: {
                    sessionId: 's-dark',
                    role: 'user',
                    content: [{ type: 'text', text: 'Dark mode message' }],
                    messageId: 'md1',
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('R1 authoring'), { timeout: T });

        await clickSidebarNode(page, 'R1 authoring');
        await page.waitForFunction(() => document.body.innerText.includes('Dark mode message'), { timeout: T });
        await capture(page, '14b-dark-session');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    }, 15000);

    test('15 reviewing callout', async () => {
        await inject(page, [
            {
                type: 'squad:init',
                payload: {
                    mode: 'M',
                    nodes: [{ id: 'RevN', task: 'review', review_criteria: ['ok'] }],
                    originalTask: 'review',
                },
            },
            {
                type: 'session:start',
                payload: { sessionId: 's-rev', nodeId: 'RevN', phase: 'reviewing', retryCount: 0 },
            },
            {
                type: 'session:message',
                payload: {
                    sessionId: 's-rev',
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Reviewing the architecture.' }],
                    messageId: 'mr1',
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('R1 reviewing'), { timeout: T });

        await clickSidebarNode(page, 'R1 reviewing');
        await page.waitForFunction(() => document.body.innerText.includes('Reviewing the architecture'), {
            timeout: T,
        });
        await capture(page, '15-reviewing-callout');
    }, 15000);

    test('16 abort returns to welcome', async () => {
        await inject(page, [{ type: 'squad:abort', payload: { reason: 'test' } }]);
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: T });
        await capture(page, '16-abort-welcome');
    }, 15000);
});
