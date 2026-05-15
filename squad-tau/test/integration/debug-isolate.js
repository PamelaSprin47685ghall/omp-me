import { startViteOnly, stopViteOnly } from '../helpers/vite-only.js';

const srv = await startViteOnly();
const baseUrl = `http://127.0.0.1:${srv.port}`;

const puppeteer = await import('puppeteer');
const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200 });

page.on('console', (msg) => console.log('BROWSER:', msg.text()));
page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
page.on('response', (resp) => {
    if (resp.status() >= 400) console.log('HTTP ERROR:', resp.status(), resp.url());
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
await page.waitForSelector('[data-app-title]', { timeout: 10000 });
console.log('=== PAGE LOADED ===');

// Step 1: Setup squad
await page.evaluate(() => {
    const es = window.__es;
    es.dispatch('squad:init', {
        mode: 'M',
        nodes: [{ id: 'flow-node', task: 'calc', review_criteria: ['ok'] }],
        originalTask: 'calc',
    });
    es.dispatch('session:start', {
        sessionId: 'flow-s1',
        nodeId: 'flow-node',
        phase: 'authoring',
        retryCount: 0,
    });
});
await page.waitForFunction(() => document.body.innerText.includes('flow-node'), { timeout: 5000 });
console.log('=== SQUAD READY ===');

// Debug: inspect sidebar DOM
const dump1 = await page.evaluate(() => {
    const trees = [...document.querySelectorAll('[role="treeitem"]')];
    return {
        treeItemCount: trees.length,
        items: trees.map((el) => ({ text: el.textContent?.substring(0, 50), html: el.innerHTML?.substring(0, 100) })),
        sidebarText: document
            .querySelector('[role="treeitem"]')
            ?.closest('[style*="flex"]')
            ?.textContent?.substring(0, 300),
    };
});
console.log('SIDEBAR DUMP:', JSON.stringify(dump1, null, 2));

// Try clicking R1 authoring
await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="treeitem"]')];
    console.log(
        'TREEITEMS:',
        items.map((el) => el.textContent),
    );
    const node = items.find((el) => el.textContent && el.textContent.includes('R1 authoring'));
    if (node) {
        console.log('FOUND NODE:', node.textContent, 'CLICKING');
        node.click();
    } else {
        console.log('NODE NOT FOUND');
    }
});

await new Promise((r) => setTimeout(r, 200));

// Check state after click
const dump2 = await page.evaluate(() => {
    const es = window.__es;
    return {
        viewMode: es.getState().ui?.viewMode,
        activeSessionId: es.getState().ui?.activeSessionId,
        pathVersion: es._pathVersions['ui'],
    };
});
console.log('AFTER CLICK:', JSON.stringify(dump2, null, 2));

await new Promise((r) => setTimeout(r, 500));

// Check if textarea exists
const hasTextarea = await page.evaluate(() => !!document.querySelector('textarea'));
console.log('TEXTAREA EXISTS:', hasTextarea);

// Check session view
const dump3 = await page.evaluate(() => document.body.innerText.substring(0, 500));
console.log('BODY TEXT:', dump3);

await browser.close();
await stopViteOnly();
