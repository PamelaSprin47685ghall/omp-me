import puppeteer from 'puppeteer';

export async function setupBrowser() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    return { browser, page };
}

export async function teardownBrowser(browser) {
    if (browser) {
        await browser.close();
    }
}

/**
 * Select the latest session in the sidebar tree view.
 * Since Sidebar no longer auto-selects sessions, this helper clicks
 * the latest R1-* node to trigger onSelectSession + setViewMode('session').
 */
export async function selectLatestSession(page, timeoutMs = 5000) {
    await page.evaluate(() => {
        // Blueprint Tree: find all node labels with "R" pattern (e.g. "R1-worker")
        const items = [...document.querySelectorAll('.bp6-tree-node-label')];
        // Find the deepest R-node (latest session)
        for (let i = items.length - 1; i >= 0; i--) {
            const text = items[i].textContent || '';
            if (text.startsWith('R')) {
                items[i].closest('.bp6-tree-node-content')?.click();
                return true;
            }
        }
        // Fallback: if no R nodes found, just click the DAG Overview node
        const dag = [...document.querySelectorAll('.bp6-tree-node-label')].find(
            (el) => el.textContent === 'DAG Overview',
        );
        dag?.closest('.bp6-tree-node-content')?.click();
        return false;
    });
}

/**
 * Click a sidebar session node matching text.
 */
export async function clickSidebarNode(page, textPattern, timeoutMs = 5000) {
    await page.evaluate((pattern) => {
        const items = [...document.querySelectorAll('.bp6-tree-node-label')];
        const node = items.find((el) => el.textContent && el.textContent.includes(pattern));
        if (node) node.closest('.bp6-tree-node-content')?.click();
    }, textPattern);
}

/**
 * Wait for the React app's own WebSocket to connect.
 * The app sets window.__wsConnected when its WS opens.
 * @returns {Promise<boolean>} true if connected within timeout
 */
export async function waitForAppWebSocket(page, timeoutMs = 10000) {
    try {
        await page.waitForFunction(() => window.__wsConnected === true, { timeout: timeoutMs });
        return true;
    } catch {
        return false;
    }
}

/**
 * Auto-select the latest session in the sidebar to view its messages.
 * Needed since Sidebar no longer auto-switches sessions.
 */
export async function selectLatestSession(page) {
    await page.evaluate(() => window.__selectLatestSession?.());
}

/**
 * @param {import('puppeteer').Page} page
 * @param {string} text
 * @param {number} timeoutMs
 */
export async function waitForText(page, text, timeoutMs) {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: timeoutMs }, text);
}

/**
 * Check WebSocket connection status in the React app.
 * @returns {Promise<boolean>}
 */
export async function isAppWebSocketConnected(page) {
    return page.evaluate(() => window.__wsConnected === true).catch(() => false);
}

export async function connectWebSocket(page, url) {
    await page.evaluate((wsUrl) => {
        window.__testWebSocket = new WebSocket(wsUrl);
        window.__testWebSocket.addEventListener('open', () => {
            window.__wsReady = true;
        });
        window.__testWebSocket.addEventListener('message', (event) => {
            if (!window.__wsMessages) window.__wsMessages = [];
            window.__wsMessages.push(JSON.parse(event.data));
        });
    }, url);

    await page.waitForFunction(() => window.__wsReady, { timeout: 10000 });

    return {
        send: async (data) => {
            await page.evaluate((payload) => {
                window.__testWebSocket.send(JSON.stringify(payload));
            }, data);
        },
        getMessages: async () => {
            return await page.evaluate(() => window.__wsMessages || []);
        },
        close: async () => {
            await page.evaluate(() => {
                if (window.__testWebSocket) {
                    window.__testWebSocket.close();
                }
            });
        },
    };
}
