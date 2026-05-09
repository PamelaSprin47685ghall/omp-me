/**
 * MITM proxy — sits between the browser and tau-mirror.
 *
 * - Injects __sessionFile into WS events for multi-session routing
 * - Appends tau-override code to frontend JS
 * - Serves session data from ~/.omp (tau-mirror hardcodes .pi; we replace)
 * - Runs on tauPort + 1000 (try offsets of 1000 if busy)
 */

import http from 'node:http';
import { homedir } from 'node:os';
import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import { INJECTED } from './injected.js';
export { INJECTED };
let tauPort = null;
let proxyServer = null;

export function getProxyPort() {
    if (!proxyServer) return null;
    const addr = proxyServer.address();
    return addr ? addr.port : null;
}

let proxyPortResolve = null;
let proxyPortPromise = null;
const browserClients = new Set();

const SESSION_CATALOG_DEBOUNCE_MS = 80;
let sessionCatalogDebounceTimer = null;
let sessionCatalogDirty = false;
let pendingSessionCatalogFile = null;

export function setTauPort(port) {
    if (tauPort) return null;
    tauPort = port;
    proxyPortPromise = new Promise((resolve) => {
        proxyPortResolve = resolve;
    });
    startProxy();
    return proxyPortPromise;
}

export function _closeProxy() {
    if (proxyServer) {
        proxyServer.close();
        proxyServer = null;
    }
    tauPort = null;
    for (const client of browserClients) {
        try {
            client.close();
        } catch {}
    }
    browserClients.clear();
    if (sessionCatalogDebounceTimer) {
        clearTimeout(sessionCatalogDebounceTimer);
        sessionCatalogDebounceTimer = null;
    }
    sessionCatalogDirty = false;
    pendingSessionCatalogFile = null;
}

function startProxy() {
    if (proxyServer) return;
    const basePort = tauPort + 1000;
    for (let offset = 0; offset < 10000; offset += 1000) {
        const port = basePort + offset;
        try {
            proxyServer = http.createServer(proxyHandler);
            const wss = new WebSocketServer({ noServer: true });

            proxyServer.on('upgrade', (req, socket, head) => {
                if (req.url !== '/ws') {
                    socket.destroy();
                    return;
                }
                wss.handleUpgrade(req, socket, head, (browserWs) => {
                    browserClients.add(browserWs);
                    flushSessionCatalogChanged();
                    const upstreamWs = new WsClient(`ws://127.0.0.1:${tauPort}/ws`);
                    const pending = [];

                    browserWs.on('message', (data) => {
                        if (upstreamWs.readyState === WsClient.OPEN) {
                            upstreamWs.send(data);
                        } else {
                            pending.push(data);
                        }
                    });

                    upstreamWs.on('open', () => {
                        for (const d of pending) upstreamWs.send(d);
                        pending.length = 0;
                    });

                    upstreamWs.on('message', (data) => {
                        let text = typeof data === 'string' ? data : data.toString();
                        if (text.includes('"type":"message_update"')) {
                            try {
                                const parsed = JSON.parse(text);
                                if (parsed?.type === 'event' && parsed.event?.type === 'message_update') {
                                    delete parsed.event.message;
                                    text = JSON.stringify(parsed);
                                }
                            } catch {}
                        }
                        browserWs.send(text);
                    });
                    upstreamWs.on('close', () => browserWs.close());
                    browserWs.on('close', () => {
                        browserClients.delete(browserWs);
                        try {
                            upstreamWs.close();
                        } catch {}
                    });
                    upstreamWs.on('error', () => browserWs.close());
                    browserWs.on('error', () => {
                        browserClients.delete(browserWs);
                        try {
                            upstreamWs.close();
                        } catch {}
                    });
                });
            });

            proxyServer.listen(port, '0.0.0.0', () => {
                if (proxyPortResolve) {
                    proxyPortResolve(port);
                    proxyPortResolve = null;
                }
            });
            return;
        } catch (e) {
            if (e.code !== 'EADDRINUSE') throw e;
        }
    }
    if (proxyPortResolve) {
        proxyPortResolve(null);
        proxyPortResolve = null;
    }
}

const knownSessions = new Set();
const knownSessionFiles = new Set();
const knownSessionIdentities = new Set();

function expandSessionFile(sf) {
    if (!sf) return null;
    return sf.startsWith('~/') ? `${homedir()}${sf.slice(1)}` : sf;
}

function getSessionIdentity(sf) {
    if (!sf || typeof sf !== 'string') return '';
    const normalizedSessionFile = sf.replaceAll('\\', '/').replace(/^~\//, '/');
    const marker = '/agent/sessions/';
    const markerIndex = normalizedSessionFile.indexOf(marker);
    if (markerIndex === -1) return normalizedSessionFile;
    return normalizedSessionFile.slice(markerIndex + marker.length);
}

export function normalizeSessionFile(sf) {
    return expandSessionFile(sf);
}

export function isKnownSessionFile(sf) {
    const expandedSessionFile = expandSessionFile(sf);
    if (!expandedSessionFile) return false;
    if (knownSessions.has(expandedSessionFile)) return true;
    const sessionIdentity = getSessionIdentity(expandedSessionFile);
    return sessionIdentity ? knownSessionIdentities.has(sessionIdentity) : false;
}

function broadcastBrowserEvent(event) {
    const payload = JSON.stringify({ type: 'event', event });
    for (const browserClient of browserClients) {
        if (browserClient.readyState === WsClient.OPEN) {
            browserClient.send(payload);
        }
    }
}

export function forwardSubagentEvent(event, sessionFile) {
    if (!sessionFile) return;
    const payload = JSON.stringify({ type: 'event', event: { ...event, __sessionFile: sessionFile } });
    for (const browserClient of browserClients) {
        if (browserClient.readyState === WsClient.OPEN) {
            browserClient.send(payload);
        }
    }
}

function hasOpenBrowserClient() {
    for (const browserClient of browserClients) {
        if (browserClient.readyState === WsClient.OPEN) return true;
    }
    return false;
}

function flushSessionCatalogChanged() {
    if (!sessionCatalogDirty || !pendingSessionCatalogFile) return;
    if (!hasOpenBrowserClient()) return;
    broadcastBrowserEvent({ type: 'session_catalog_changed', sessionFile: pendingSessionCatalogFile });
    sessionCatalogDirty = false;
}

function scheduleSessionCatalogChanged(sessionFile) {
    if (!sessionFile) return;
    pendingSessionCatalogFile = sessionFile;
    sessionCatalogDirty = true;
    if (sessionCatalogDebounceTimer) return;
    sessionCatalogDebounceTimer = setTimeout(() => {
        sessionCatalogDebounceTimer = null;
        flushSessionCatalogChanged();
    }, SESSION_CATALOG_DEBOUNCE_MS);
}

export function activateSessionFile(sf) {
    const expandedSessionFile = expandSessionFile(sf);
    if (!expandedSessionFile) return;
    const payload = JSON.stringify({ type: 'mirror_sync', sessionFile: expandedSessionFile, forced: true });
    for (const browserClient of browserClients) {
        if (browserClient.readyState === WsClient.OPEN) {
            browserClient.send(payload);
        }
    }
}

export function addSessionFile(sf) {
    const expandedSessionFile = expandSessionFile(sf);
    if (!expandedSessionFile) return;

    knownSessions.add(expandedSessionFile);

    const identity = getSessionIdentity(expandedSessionFile);
    if (identity) knownSessionIdentities.add(identity);

    if (!knownSessionFiles.has(expandedSessionFile)) {
        knownSessionFiles.add(expandedSessionFile);
    }

    scheduleSessionCatalogChanged(expandedSessionFile);
}

const OMP_SESSIONS_DIR = join(homedir(), '.omp', 'agent', 'sessions');

async function parseOmpSessionFile(filePath) {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let header = null;
    let firstMessage = null;
    let sessionName = null;
    let userMessageCount = 0;
    let lineCount = 0;

    for await (const line of rl) {
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
        } catch {
            /* skip */
        }
        if (lineCount > 50 && firstMessage) break;
    }

    rl.close();
    stream.destroy();

    if (!header?.id) return null;

    return {
        id: header.id,
        timestamp: header.timestamp || '',
        name: sessionName,
        firstMessage,
        cwd: header.cwd || null,
    };
}

async function scanOmpSessions() {
    if (!existsSync(OMP_SESSIONS_DIR)) return { projects: [] };

    const dirEntries = readdirSync(OMP_SESSIONS_DIR, { withFileTypes: true });
    const projects = [];

    for (const dir of dirEntries) {
        if (!dir.isDirectory()) continue;

        const projectDir = join(OMP_SESSIONS_DIR, dir.name);
        const files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
        const decodedPath = dir.name.replace(/^--/, '/').replace(/--$/, '').replace(/-/g, '/');
        const sessions = [];

        for (const file of files) {
            try {
                const filePath = join(projectDir, file);
                if (!isKnownSessionFile(filePath)) continue;
                const parsed = await parseOmpSessionFile(filePath);
                if (parsed) {
                    const stat = statSync(filePath);
                    sessions.push({ ...parsed, file, filePath, mtime: stat.mtimeMs });
                }
            } catch {
                /* skip */
            }
        }

        sessions.sort((a, b) => b.mtime - a.mtime);

        if (sessions.length > 0) {
            projects.push({ path: decodedPath, dirName: dir.name, sessions });
        }
    }

    projects.sort((a, b) => {
        const aTime = a.sessions[0]?.mtime || 0;
        const bTime = b.sessions[0]?.mtime || 0;
        return bTime - aTime;
    });

    return { projects };
}

function serveOmpSessionFile(res, dirName, file) {
    const filePath = join(OMP_SESSIONS_DIR, dirName, file);

    if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
    }

    const entries = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';

    stream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.trim()) {
                try {
                    entries.push(JSON.parse(line));
                } catch {
                    /* skip */
                }
            }
        }
    });

    stream.on('end', () => {
        if (buffer.trim()) {
            try {
                entries.push(JSON.parse(buffer));
            } catch {
                /* skip */
            }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify({ entries }));
    });

    stream.on('error', (e) => {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify({ error: e.message }));
    });
}

async function searchOmpSessions(query) {
    if (!existsSync(OMP_SESSIONS_DIR)) return { results: [] };

    const q = query.toLowerCase();
    const results = [];
    const MAX_RESULTS = 30;

    const dirEntries = readdirSync(OMP_SESSIONS_DIR, { withFileTypes: true });

    for (const dir of dirEntries) {
        if (!dir.isDirectory()) continue;
        if (results.length >= MAX_RESULTS) break;

        const projectDir = join(OMP_SESSIONS_DIR, dir.name);
        const decodedPath = dir.name.replace(/^--/, '/').replace(/--$/, '').replace(/-/g, '/');
        const files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));

        for (const file of files) {
            if (results.length >= MAX_RESULTS) break;

            try {
                const filePath = join(projectDir, file);
                if (!isKnownSessionFile(filePath)) continue;

                const stream = createReadStream(filePath, { encoding: 'utf8' });
                const rl = createInterface({ input: stream, crlfDelay: Infinity });

                let sessionId = '';
                let sessionName = '';
                let sessionTimestamp = '';
                let firstMessage = '';
                const matches = [];

                for await (const line of rl) {
                    if (!line.trim()) continue;
                    try {
                        const entry = JSON.parse(line);

                        if (entry.type === 'session') {
                            sessionId = entry.id;
                            sessionTimestamp = entry.timestamp || '';
                        }
                        if (entry.type === 'session_info' && entry.name) {
                            sessionName = entry.name;
                        }
                        if (entry.type === 'message') {
                            const content = entry.message?.content;
                            let text = '';
                            if (typeof content === 'string') text = content;
                            else if (Array.isArray(content)) {
                                text = content
                                    .filter((b) => b.type === 'text')
                                    .map((b) => b.text)
                                    .join(' ');
                            }

                            if (!firstMessage && entry.message?.role === 'user' && text) {
                                firstMessage = text.substring(0, 120);
                            }

                            if (text && text.toLowerCase().includes(q)) {
                                const idx = text.toLowerCase().indexOf(q);
                                const start = Math.max(0, idx - 60);
                                const end = Math.min(text.length, idx + q.length + 60);
                                const snippet =
                                    (start > 0 ? '\u2026' : '') +
                                    text.substring(start, end) +
                                    (end < text.length ? '\u2026' : '');

                                matches.push({
                                    role: entry.message?.role || 'unknown',
                                    snippet: snippet.replace(/\n/g, ' '),
                                });

                                if (matches.length >= 3) break;
                            }
                        }
                    } catch {
                        /* skip line */
                    }
                }

                rl.close();
                stream.destroy();

                if (matches.length > 0) {
                    results.push({
                        id: sessionId,
                        name: sessionName,
                        timestamp: sessionTimestamp,
                        path: decodedPath,
                        file,
                        filePath,
                        firstMessage,
                        matches,
                    });
                }
            } catch {
                /* skip file */
            }
        }
    }

    return { results };
}

const FORWARD_HEADERS = new Set([
    'content-type',
    'content-length',
    'accept',
    'authorization',
    'cookie',
    'x-requested-with',
]);

function collectBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function buildUpstreamHeaders(req) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (k && FORWARD_HEADERS.has(k.toLowerCase())) {
            headers[k] = v;
        }
    }
    return headers;
}

const UPSTREAM_BASE = () => `http://127.0.0.1:${tauPort}`;

async function proxyHandler(req, res) {
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return;

    if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders());
        res.end();
        return;
    }

    const urlPath = req.url.split('?')[0];

    if (urlPath === '/api/sessions' && req.method === 'GET') {
        try {
            const data = await scanOmpSessions();
            res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
            res.end(JSON.stringify(data));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders() });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    const sessionMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/([^/]+)$/);
    if (sessionMatch && req.method === 'GET') {
        serveOmpSessionFile(res, sessionMatch[1], sessionMatch[2]);
        return;
    }

    if (urlPath === '/api/search' && req.method === 'GET') {
        try {
            const searchUrl = new URL(`http://localhost${req.url}`);
            const q = searchUrl.searchParams.get('q') || '';
            const data = await searchOmpSessions(q);
            res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
            res.end(JSON.stringify(data));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders() });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    const body = req.method !== 'GET' && req.method !== 'HEAD' ? await collectBody(req) : undefined;
    const upstreamUrl = UPSTREAM_BASE() + req.url;
    const upstreamHeaders = buildUpstreamHeaders(req);
    const fetchOpts = { method: req.method, headers: upstreamHeaders };
    if (body && body.length > 0) fetchOpts.body = body;

    if (urlPath === '/api/qr') {
        const upstreamRes = await fetch(upstreamUrl, fetchOpts);
        let html = await upstreamRes.text();
        const proxyPort = getProxyPort();
        if (proxyPort) {
            html = html.replace(new RegExp(`:${tauPort}(?=[/"']|$)`, 'g'), `:${proxyPort}`);
        }
        res.writeHead(upstreamRes.status, { 'Content-Type': 'text/html', ...corsHeaders() });
        res.end(html);
        return;
    }

    const upstreamRes = await fetch(upstreamUrl, fetchOpts);

    if (urlPath === '/app.js') {
        const text = await upstreamRes.text();
        res.writeHead(upstreamRes.status, { 'Content-Type': 'application/javascript', ...corsHeaders() });
        res.end(text + INJECTED);
        return;
    }

    const ct = upstreamRes.headers.get('content-type') || '';
    const rh = {};
    if (ct) rh['Content-Type'] = ct;
    res.writeHead(upstreamRes.status, { ...rh, ...corsHeaders() });
    if (upstreamRes.body) {
        for await (const chunk of upstreamRes.body) {
            res.write(chunk);
        }
        res.end();
    } else {
        res.end();
    }
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}
