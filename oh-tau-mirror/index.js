/**
 * oh-tau-mirror — oh-my-pi extension adaptor for tau-mirror
 *
 * Wraps tau-mirror's pi extension (https://www.npmjs.com/package/tau-mirror)
 * as an oh-my-pi extension, following the same pattern as oh-taskplane,
 * oh-studio, advisor, and ollama-search.
 *
 * tau-mirror's extension entry is at ./extensions/mirror-server.ts in the
 * npm package. It only uses `import type` for @mariozechner/pi-coding-agent
 * (erased at runtime), so no shim package is needed.
 *
 * All external imports use file:// paths (AGENTS.md pattern) instead of
 * bare package specifiers, avoiding Bun's module resolution pitfalls and
 * preventing unnecessary peer-dep installation.
 *
 * tau-mirror's console.log/error calls (e.g. "[Mirror] Browser client connected")
 * are suppressed globally — they clutter the TUI and carry no actionable
 * information for the user.
 */

import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';

/** Latest context captured from any forwarded Pi event. */
let latestCtx = null;

/** All session files seen by this process via forwarded events. */
const processSessions = new Set();

// ---------------------------------------------------------------------------
// Suppress tau-mirror's console noise entirely
// ---------------------------------------------------------------------------

console.log = () => {};
console.warn = () => {};
console.error = () => {};

// ---------------------------------------------------------------------------
// Events that exist in the original @mariozechner/pi-coding-agent ExtensionAPI
// but have no direct equivalent in oh-my-pi's ExtensionAPI.
// ---------------------------------------------------------------------------

const UNSUPPORTED_EVENTS = new Set(['model_select']);

export default async function ohTauMirrorAdaptor(pi) {
    // Resolve tau-mirror's extension entry from the npm-installed package.
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const extPath = join(__dirname, 'node_modules', 'tau-mirror', 'extensions', 'mirror-server.ts');

    // Hijack tau-mirror's HTTP server so that /api/sessions only returns
    // sessions that have been seen by this process (no stale or sibling sessions).
    const originalOn = pi.on.bind(pi);
    const hijackedOn = (event, handler) => {
        if (event !== 'session_start') return originalOn(event, handler);
        return originalOn(event, async (evt, ctx) => {
            latestCtx = ctx;
            const sf = ctx?.sessionManager?.getSessionFile?.();
            if (sf) processSessions.add(sf);
            const originalCreateServer = http.createServer;
            http.createServer = function (...args) {
                // Restore immediately — only intercept this single call.
                http.createServer = originalCreateServer;
                const server = originalCreateServer.apply(this, args);
                const serverOn = server.on.bind(server);
                server.on = function (eventName, listener) {
                    if (eventName !== 'request') return serverOn(eventName, listener);
                    const wrapped = (req, res) => {
                        if (req.url === '/api/sessions' || req.url?.startsWith('/api/sessions?')) {
                            serveCurrentSessionOnly(req, res);
                            return;
                        }
                        return listener(req, res);
                    };
                    return serverOn(eventName, wrapped);
                };
                return server;
            };
            await handler(evt, ctx);
        });
    };
    pi.on = hijackedOn;

    const { default: tauMirrorExtension } = await import('file://' + extPath);

    const bridge = createBridge(pi);
    tauMirrorExtension(bridge);

    pi.on = originalOn;
}

/**
 * Parse the first ~8 KB of a session file to extract display metadata.
 */
function parseSessionFile(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);
        const text = buf.toString('utf8', 0, bytesRead);
        const lines = text.split('\n');

        let header = null;
        let firstMessage = null;
        let sessionName = null;
        let userMessageCount = 0;
        let lineCount = 0;

        for (const line of lines) {
            if (!line.trim()) continue;
            lineCount++;
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'session') header = entry;
                else if (entry.type === 'session_info' && entry.name) sessionName = entry.name;
                else if (entry.type === 'message' && entry.message?.role === 'user') {
                    userMessageCount++;
                    if (!firstMessage) {
                        const content = entry.message.content;
                        if (typeof content === 'string') firstMessage = content.substring(0, 120);
                        else if (Array.isArray(content)) {
                            const tb = content.find((b) => b.type === 'text');
                            if (tb) firstMessage = tb.text.substring(0, 120);
                        }
                    }
                }
            } catch {}
            if (lineCount > 50 && firstMessage) break;
        }

        if (!header?.id) return null;
        if (userMessageCount <= 1 && lineCount <= 8) return null; // pipe mode

        return {
            id: header.id,
            timestamp: header.timestamp || '',
            name: sessionName,
            firstMessage,
            cwd: header.cwd || null,
        };
    } catch {
        return null;
    }
}

/**
 * Serve a /api/sessions response that contains only sessions
 * observed by this process (no stale or sibling sessions).
 */
function serveCurrentSessionOnly(_req, res) {
    const projectsMap = new Map();

    for (const sessionFile of processSessions) {
        if (!fs.existsSync(sessionFile)) continue;
        const parsed = parseSessionFile(sessionFile);
        if (!parsed) continue;

        const stat = fs.statSync(sessionFile);
        const dirName = basename(dirname(sessionFile));
        const fileName = basename(sessionFile);
        const decodedPath = dirName.replace(/^--/, '/').replace(/--$/, '').replace(/-/g, '/');

        if (!projectsMap.has(decodedPath)) {
            projectsMap.set(decodedPath, {
                path: decodedPath,
                dirName,
                sessions: [],
            });
        }

        projectsMap.get(decodedPath).sessions.push({
            id: parsed.id,
            timestamp: parsed.timestamp,
            name: parsed.name,
            firstMessage: parsed.firstMessage,
            file: fileName,
            filePath: sessionFile,
            mtime: stat.mtimeMs,
        });
    }

    const projects = Array.from(projectsMap.values());
    for (const project of projects) {
        project.sessions.sort((a, b) => b.mtime - a.mtime);
    }
    projects.sort((a, b) => {
        const aTime = a.sessions[0]?.mtime || 0;
        const bTime = b.sessions[0]?.mtime || 0;
        return bTime - aTime;
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projects }));
}

/**
 * Create a bridge from oh-my-pi ExtensionAPI to the original
 * @mariozechner/pi-coding-agent ExtensionAPI that tau-mirror expects.
 *
 * tau-mirror uses these ExtensionAPI methods:
 *   registerCommand, on, sendUserMessage,
 *   getSessionName, setSessionName,
 *   getThinkingLevel, setThinkingLevel,
 *   setModel
 *
 * And these ExtensionCommandContext/ExtensionContext properties (passthrough):
 *   ctx.ui.notify, ctx.ui.setStatus,
 *   ctx.sessionManager.getSessionFile, ctx.sessionManager.getEntries,
 *   ctx.cwd, ctx.model, ctx.isIdle(), ctx.getContextUsage(), ctx.abort()
 *
 * model_select is silently dropped — oh-my-pi doesn't fire this event.
 */
export function createBridge(pi) {
    return {
        registerCommand(name, opts) {
            pi.registerCommand(name, opts);
        },

        on(event, handler) {
            if (UNSUPPORTED_EVENTS.has(event)) {
                // oh-my-pi does not fire model_select; handler never runs.
                return;
            }
            pi.on(event, (evt, ctx) => {
                latestCtx = ctx;
                const sf = ctx?.sessionManager?.getSessionFile?.();
                if (sf) processSessions.add(sf);
                return handler(evt, ctx);
            });
        },

        sendUserMessage(content, opts) {
            pi.sendUserMessage(content, opts);
        },

        setModel(model) {
            return pi.setModel(model);
        },

        getSessionName() {
            return pi.getSessionName();
        },

        setSessionName(name) {
            return pi.setSessionName(name);
        },

        getThinkingLevel() {
            return pi.getThinkingLevel();
        },

        setThinkingLevel(level) {
            pi.setThinkingLevel(level);
        },
    };
}
