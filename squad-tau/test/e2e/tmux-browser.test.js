/**
 * Tmux Browser E2E — Verifies Squad-Tau UI displays correctly in a real OMP environment.
 * Starts OMP in tmux, triggers squad, then uses Puppeteer to check the web interface.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { setupBrowser, teardownBrowser } from '../helpers/puppeteer-setup.js';

const execAsync = promisify(exec);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForTmuxOutput(session, pattern, timeoutMs = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            // We use -p to get plain text and -S/-E to get full buffer if needed,
            // but usually capture-pane -p is enough.
            const { stdout } = await execAsync(`tmux capture-pane -t ${session} -p 2>/dev/null`);
            if (stdout.match(pattern)) return stdout;
        } catch (err) {
            // tmux session might not be ready yet
        }
        await sleep(1500);
    }
    throw new Error(`Timeout waiting for pattern ${pattern} in tmux session ${session}`);
}

async function getSquadUiUrl(session, timeoutMs = 45000) {
    const output = await waitForTmuxOutput(session, /Squad UI: (http:\/\/127\.0\.0\.1:\d+)/, timeoutMs);
    const match = output.match(/Squad UI: (http:\/\/127\.0\.0\.1:\d+)/);
    return match ? match[1] : null;
}

describe('Tmux Browser E2E', () => {
    let tmuxSession;
    let testDir;
    let uiUrl;
    let browser;
    let page;

    beforeAll(async () => {
        testDir = `/tmp/squad-tmux-e2e-${Date.now()}`;
        tmuxSession = `squad-tmux-e2e-${process.pid}`;
        const pluginPath = path.resolve(process.cwd(), 'index.js');

        await execAsync(`mkdir -p ${testDir}`);

        // 1. Start OMP with the plugin in a detached tmux session
        const cmd = `cd ${testDir} && SQUAD_E2E=1 omp -e ${pluginPath}`;
        await execAsync(`tmux new-session -d -s ${tmuxSession} "${cmd}"`);

        // Wait for OMP to initialize
        await sleep(5000);

        // 2. Send /squad command to start the engine and trigger UI notification
        await execAsync(`tmux send-keys -t ${tmuxSession} "/squad list files in current directory" C-m`);

        // 3. Capture the UI URL from the tmux output
        uiUrl = await getSquadUiUrl(tmuxSession, 60000);
        if (!uiUrl) throw new Error('Failed to capture Squad UI URL from tmux');

        // 4. Setup browser
        const b = await setupBrowser();
        browser = b.browser;
        page = b.page;
    }, 120000);

    afterAll(async () => {
        await teardownBrowser(browser);
        try {
            await execAsync(`tmux kill-session -t ${tmuxSession} 2>/dev/null || true`);
        } catch {}
    });

    test('UI loads and displays the brand name', async () => {
        // Use domcontentloaded for speed
        await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Wait for body to contain "Squad-Tau" instead of a specific selector
        // This is more robust against React hydration timing or rendering delays
        await page.waitForFunction(() => document.body.innerText.includes('Squad-Tau'), { timeout: 10000 });
    }, 20000);

    test('UI shows the Welcome or Task message', async () => {
        await page.waitForFunction(
            () => {
                const text = document.body.innerText;
                return text.includes('Welcome to Squad-Tau') || text.includes('R1-worker') || text.includes('Task');
            },
            { timeout: 10000 },
        );
    }, 20000);
});
