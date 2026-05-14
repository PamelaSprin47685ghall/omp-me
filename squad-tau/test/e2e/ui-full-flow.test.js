/**
 * Dehydrated UI Full Flow — visual regression gallery.
 *
 * No backend engine. No WS. No db. Pure Vite + direct event injection.
 * Screenshots capture every visual state for review.
 */
import fs from 'fs';
import path from 'path';
import { describe, test, beforeAll, afterAll, expect } from 'bun:test';
import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

const SHOT_DIR = `/tmp/squad-ui-full-flow-${Date.now()}-${process.pid}`;
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function capture(page, name) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
    return name;
}

function inject(page, events) {
    return page.evaluate((evts) => window.__injectEvents(evts), events);
}

function reset(page) {
    return page.evaluate(() => window.__resetEventStore());
}

describe('UI Full Flow', () => {
    let browser, page, baseUrl;

    beforeAll(async () => {
        const srv = await startViteOnly();
        baseUrl = `http://127.0.0.1:${srv.port}`;
        const launched = await setupBrowser();
        browser = launched.browser;
        page = launched.page;
        await page.setViewport({ width: 1600, height: 1200 });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#root', { timeout: 10000 });
    }, 60000);

    afterAll(async () => {
        await teardownBrowser(browser);
        await stopViteOnly();
    }, 60000);

    test('01 welcome page', async () => {
        expect(await page.$eval('[data-app-title]', (el) => el.textContent)).toBe('Squad-Tau');
        await capture(page, '01-welcome');
    }, 10000);

    test('02 model pool drawer empty and filled', async () => {
        await page.evaluate(() => {
            const btn = document.querySelector('button[aria-label="Model Pool"]');
            if (btn) btn.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Model Pool Configuration'), {
            timeout: 5000,
        });
        await capture(page, '02a-drawer-empty');

        await inject(page, [
            {
                type: 'model_pool:snapshot',
                payload: {
                    slots: [
                        {
                            slotId: 's1',
                            provider: 'anthropic',
                            modelId: 'claude-3-5-sonnet',
                            role: 'worker',
                            thinkingLevel: 'medium',
                            inUse: true,
                        },
                        {
                            slotId: 's2',
                            provider: 'openai',
                            modelId: 'gpt-4.1',
                            role: 'reviewer',
                            thinkingLevel: 'low',
                            inUse: false,
                        },
                    ],
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('claude-3-5-sonnet'), { timeout: 3000 });
        await capture(page, '02b-drawer-filled');
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
                payload: { sessionId: 'flow-s1', nodeId: 'flow-node', phase: 'worker', retryCount: 0 },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('flow-node'), { timeout: 3000 });
        await capture(page, '03-dag-and-tree');
    }, 10000);

    test('04 session input and user message', async () => {
        await page.evaluate(() => window.__selectLatestSession?.());
        await page.waitForFunction(() => document.querySelector('textarea') !== null, { timeout: 3000 });
        await capture(page, '04a-session-input');

        const textarea = await page.waitForSelector('textarea', { timeout: 3000 });
        await textarea.focus();
        await page.keyboard.type('Please add keyboard support');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('textarea')?.value === '', { timeout: 3000 });
        await capture(page, '04b-user-message');
    }, 15000);

    test('05 thinking block collapsed and expanded', async () => {
        await page.evaluate((sid) => window.__setActiveSessionId?.(sid), 'flow-s1');

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
        await page.waitForFunction(() => document.body.innerText.includes('Thinking'), { timeout: 3000 });
        await capture(page, '05a-thinking-collapsed');

        await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('[role="button"]')];
            const thinkHeader = buttons.find((b) => b.textContent.includes('Thinking'));
            if (thinkHeader) thinkHeader.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Planning the implementation...'), {
            timeout: 3000,
        });
        await capture(page, '05b-thinking-expanded');
    }, 15000);

    test('06 tool call collapsed expanded and done', async () => {
        await inject(page, [
            {
                type: 'session:tool_call',
                payload: {
                    sessionId: 'flow-s1',
                    toolName: 'read',
                    toolId: 'tool-1',
                    params: { path: 'client/App.jsx' },
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('read'), { timeout: 3000 });
        await capture(page, '06a-tool-collapsed');

        await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('[role="button"]')];
            const toolHeader = buttons.find((b) => b.textContent.includes('read') && b.textContent.includes('client'));
            if (toolHeader) toolHeader.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('client/App.jsx'), { timeout: 3000 });
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
        await page.waitForFunction(() => document.body.innerText.includes('done'), { timeout: 3000 });
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
        await page.waitForFunction(() => document.body.innerText.includes('Calculator crashed'), { timeout: 3000 });
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
            timeout: 3000,
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
        await page.waitForFunction(() => document.body.innerText.includes('blocked'), { timeout: 3000 });
        await capture(page, '09-dag-status-colors');
    }, 10000);

    test('10 sidebar with sessions and outer review', async () => {
        await inject(page, [
            { type: 'session:start', payload: { sessionId: 's-a1', nodeId: 'A', phase: 'worker', retryCount: 0 } },
            { type: 'session:start', payload: { sessionId: 's-a2', nodeId: 'A', phase: 'reviewer', retryCount: 1 } },
            { type: 'session:start', payload: { sessionId: 's-b1', nodeId: 'B', phase: 'worker', retryCount: 0 } },
            {
                type: 'session:start',
                payload: { sessionId: 's-outer', nodeId: null, phase: 'outer_review', retryCount: 0 },
            },
        ]);
        await page.waitForFunction(
            () => document.body.innerText.includes('R2 reviewer') && document.body.innerText.includes('outer review'),
            { timeout: 3000 },
        );
        await capture(page, '10-sidebar-sessions');
    }, 10000);

    test('11 tool error state', async () => {
        await inject(page, [
            { type: 'session:start', payload: { sessionId: 's-err', nodeId: 'ErrN', phase: 'worker', retryCount: 2 } },
        ]);

        await page.evaluate(() => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const node = items.find((el) => el.textContent && el.textContent.includes('R3 worker'));
            if (node) node.click();
        });

        await inject(page, [
            {
                type: 'session:tool_call',
                payload: { sessionId: 's-err', toolName: 'bash', toolId: 'tc-err', params: { command: 'rm -rf /' } },
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
        await page.waitForFunction(() => document.body.innerText.includes('error'), { timeout: 3000 });
        await capture(page, '11-tool-error');
    }, 10000);

    test('12 long message does not overflow', async () => {
        await page.evaluate(() => window.__selectLatestSession?.());
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
        await page.waitForFunction(() => document.body.innerText.includes('AAAA'), { timeout: 3000 });
        const msgText = await page.$eval('[data-user-msg]', (el) => el.textContent);
        expect(msgText).toContain(longText.slice(0, 50));
        await capture(page, '12-long-message');
    }, 10000);

    test('13 model pool drawer edit mode', async () => {
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const btn = btns.find((b) => b.getAttribute('aria-label') === 'Model Pool');
            if (btn) btn.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Model Pool Configuration'), {
            timeout: 3000,
        });

        await inject(page, [
            {
                type: 'model_pool:snapshot',
                payload: {
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
                },
            },
        ]);
        await page.waitForFunction(() => document.body.innerText.includes('gemini'), { timeout: 3000 });

        await page.evaluate(() => {
            const rows = [...document.querySelectorAll('tbody tr')];
            rows[0]?.querySelector('button[aria-label="Edit slot"]')?.click();
        });
        await page.waitForFunction(() => document.querySelector('select') !== null, { timeout: 3000 });
        await capture(page, '13-drawer-edit');
        await page.keyboard.press('Escape');
    }, 15000);

    test('14 dark mode welcome and session', async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForSelector('#root', { timeout: 5000 });
        await page.waitForFunction(() => document.documentElement.classList.contains('dark'), { timeout: 5000 });
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
                payload: { sessionId: 's-dark', nodeId: 'DarkN', phase: 'worker', retryCount: 0 },
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
        await page.waitForFunction(() => document.body.innerText.includes('R1 worker'), { timeout: 3000 });

        await page.evaluate(() => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const node = items.find((el) => el.textContent && el.textContent.includes('R1 worker'));
            if (node) node.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Dark mode message'), { timeout: 3000 });
        await capture(page, '14b-dark-session');
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    }, 15000);

    test('15 reviewer callout', async () => {
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
                payload: { sessionId: 's-rev', nodeId: 'RevN', phase: 'reviewer', retryCount: 0 },
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
        await page.waitForFunction(() => document.body.innerText.includes('R1 reviewer'), { timeout: 3000 });

        await page.evaluate(() => {
            const items = [...document.querySelectorAll('[role="treeitem"]')];
            const node = items.find((el) => el.textContent && el.textContent.includes('R1 reviewer'));
            if (node) node.click();
        });
        await page.waitForFunction(() => document.body.innerText.includes('Reviewing the architecture'), {
            timeout: 3000,
        });
        await capture(page, '15-reviewer-callout');
    }, 15000);

    test('16 abort returns to welcome', async () => {
        await inject(page, [{ type: 'squad:abort', payload: { reason: 'test' } }]);
        await page.waitForFunction(() => document.body.innerText.includes('Welcome to Squad-Tau'), { timeout: 3000 });
        await capture(page, '16-abort-welcome');
    }, 10000);
});
