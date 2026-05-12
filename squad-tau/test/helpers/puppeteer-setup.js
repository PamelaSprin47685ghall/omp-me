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
