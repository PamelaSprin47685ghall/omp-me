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

// ---------------------------------------------------------------------------
// tau-override: appended to app.js before the browser receives it
// ---------------------------------------------------------------------------
export const INJECTED = `

// === tau-override: multi-session routing ===
(() => {
  let currentSessionFile = null;
  const bgQueues = new Map();

  function getSessionIdentity(sessionFile) {
    if (!sessionFile || typeof sessionFile !== 'string') return '';
    const normalized = sessionFile.replace(/\\\\/g, '/').replace(/^~\\//, '/');
    const marker = '/agent/sessions/';
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex !== -1) return normalized.slice(markerIndex + marker.length);
    return normalized;
  }

  function sameSessionFile(leftSessionFile, rightSessionFile) {
    return getSessionIdentity(leftSessionFile) === getSessionIdentity(rightSessionFile);
  }

  function findSessionItem(sessionFile) {
    if (!sessionFile) return null;
    if (typeof document.querySelector === 'function') {
      const exactMatch = document.querySelector('.session-item[data-file-path="' + sessionFile.replace(/"/g, '&quot;') + '"]');
      if (exactMatch) return exactMatch;
    }
    if (typeof document.querySelectorAll !== 'function') return null;
    for (const item of document.querySelectorAll('.session-item')) {
      if (sameSessionFile(item?.dataset?.filePath, sessionFile)) return item;
    }
    return null;
  }

  function findSessionObject(sessionFile) {
    if (!sessionFile || !Array.isArray(sidebar.projects)) return null;
    for (const project of sidebar.projects) {
      if (!Array.isArray(project?.sessions)) continue;
      for (const session of project.sessions) {
        if (sameSessionFile(session?.filePath, sessionFile)) {
          return { session, project };
        }
      }
    }
    return null;
  }

  let pendingMirrorSyncFile = null;

  function syncActiveSessionForMirror(force) {
    if (!mirrorActiveSessionFile) return;
    if (!force) {
      const isTrackingMirrorSession = !currentSessionFile || sameSessionFile(currentSessionFile, mirrorActiveSessionFile);
      if (!isTrackingMirrorSession) return;
    }

    currentSessionFile = mirrorActiveSessionFile;
    const matchedSessionItem = findSessionItem(mirrorActiveSessionFile);
    if (matchedSessionItem?.dataset?.filePath) {
      currentSessionFile = matchedSessionItem.dataset.filePath;
    }
    if (typeof sidebar.setActive === 'function' && currentSessionFile) {
      sidebar.setActive(currentSessionFile);
    }

    if (force && typeof switchSession === 'function') {
      const found = findSessionObject(mirrorActiveSessionFile);
      if (found) {
        switchSession(currentSessionFile, found.session, found.project);
      } else {
        pendingMirrorSyncFile = mirrorActiveSessionFile;
      }
    }

    // Restore streaming element so that mid-stream message_update events
    // rendered by handleMirrorSync can be updated incrementally.
    if (typeof currentStreamingElement !== 'undefined' && !currentStreamingElement) {
      const streamingMsg = typeof document.querySelector === 'function'
        ? document.querySelector('.message.assistant .message-content.streaming')
        : null;
      if (streamingMsg) {
        currentStreamingElement = streamingMsg.closest('.message.assistant');
        // Reconstruct accumulated text from the DOM
        if (typeof currentStreamingText !== 'undefined') {
          const textNode = streamingMsg.querySelector('.streaming-text');
          if (textNode) currentStreamingText = textNode.textContent || '';
        }
        if (typeof currentStreamingThinking !== 'undefined') {
          const thinkingNode = streamingMsg.querySelector('.streaming-thinking .thinking-content');
          if (thinkingNode) currentStreamingThinking = thinkingNode.textContent || '';
        }
      }
    }
  }

  // Track which session the user is viewing via sidebar clicks
  sidebar.container.addEventListener('click', (e) => {
    const item = e.target.closest('.session-item');
    if (item) {
      currentSessionFile = item.dataset.filePath;
      if (mirrorActiveSessionFile && sameSessionFile(currentSessionFile, mirrorActiveSessionFile)) {
        currentSessionFile = mirrorActiveSessionFile;
      }
      flushBg(currentSessionFile);
    }
  });

  function filterOrEnqueue(ev) {
    const sf = ev.__sessionFile;
    if (!sf) return true;
    if (!currentSessionFile || sameSessionFile(sf, currentSessionFile)) return true;
    if (!bgQueues.has(sf)) bgQueues.set(sf, []);
    bgQueues.get(sf).push(ev);
    showBadge(sf);
    return false;
  }

  function flushBg(sf) {
    const queue = bgQueues.get(sf);
    if (!queue) return;
    bgQueues.delete(sf);
    hideBadge(sf);
    for (const ev of queue) handleRPCEvent(ev);
  }

  function showBadge(sf) {
    const item = findSessionItem(sf);
    if (!item) return;
    let badge = item.querySelector('.bg-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'bg-badge';
      item.querySelector('.session-title-row')?.appendChild(badge);
    }
    const count = (bgQueues.get(sf) || []).length;
    badge.textContent = count > 0 ? String(count) : '\u2022';
    item.classList.add('has-bg-activity');
  }

  function hideBadge(sf) {
    const item = findSessionItem(sf);
    if (!item) return;
    const badge = item.querySelector('.bg-badge');
    if (badge) badge.remove();
    item.classList.remove('has-bg-activity');
  }

  let sidebarRefreshPromise = null;
  let sidebarRefreshQueued = false;

  function alignKnownSessionFilePaths() {
    if (!Array.isArray(sidebar.projects)) return;
    if (!mirrorActiveSessionFile) return;
    for (const project of sidebar.projects) {
      if (!Array.isArray(project?.sessions)) continue;
      for (const session of project.sessions) {
        if (sameSessionFile(session?.filePath, mirrorActiveSessionFile)) {
          session.filePath = mirrorActiveSessionFile;
        }
      }
    }
    if (typeof document.querySelectorAll === 'function') {
      for (const item of document.querySelectorAll('.session-item')) {
        if (sameSessionFile(item?.dataset?.filePath, mirrorActiveSessionFile)) {
          item.dataset.filePath = mirrorActiveSessionFile;
        }
      }
    }
    if (currentSessionFile && sameSessionFile(currentSessionFile, mirrorActiveSessionFile)) {
      currentSessionFile = mirrorActiveSessionFile;
    }
  }

  function patchSessionSwitchForMirrorPaths() {
    if (typeof switchSession !== 'function') return;
    if (switchSession.__tauMirrorPatched) return;
    const originalSwitchSession = switchSession;
    const patchedSwitchSession = async function (sessionFile, session, project) {
      if (isMirrorMode && mirrorActiveSessionFile && sameSessionFile(sessionFile, mirrorActiveSessionFile)) {
        sessionFile = mirrorActiveSessionFile;
        if (session && typeof session === 'object') session.filePath = mirrorActiveSessionFile;
      }
      return originalSwitchSession(sessionFile, session, project);
    };
    patchedSwitchSession.__tauMirrorPatched = true;
    switchSession = patchedSwitchSession;
  }

  function reloadSidebar() {
    if (sidebarRefreshPromise) {
      sidebarRefreshQueued = true;
      return sidebarRefreshPromise;
    }

    sidebarRefreshPromise = sidebar.loadSessions().then(() => {
      alignKnownSessionFilePaths();
      patchSessionSwitchForMirrorPaths();
      syncActiveSessionForMirror();
    }).finally(() => {
      const shouldReloadAgain = sidebarRefreshQueued;
      sidebarRefreshQueued = false;
      sidebarRefreshPromise = null;
      if (typeof updateMirrorLiveIndicator === 'function') updateMirrorLiveIndicator();
      if (currentSessionFile) flushBg(currentSessionFile);
      if (pendingMirrorSyncFile && sameSessionFile(pendingMirrorSyncFile, mirrorActiveSessionFile)) {
        const found = findSessionObject(mirrorActiveSessionFile);
        if (found && typeof switchSession === 'function') {
          currentSessionFile = found.session.filePath || mirrorActiveSessionFile;
          if (typeof sidebar.setActive === 'function') sidebar.setActive(currentSessionFile);
          switchSession(currentSessionFile, found.session, found.project);
          flushBg(currentSessionFile);
        }
        pendingMirrorSyncFile = null;
      }
      if (shouldReloadAgain) reloadSidebar();
    });

    return sidebarRefreshPromise;
  }

  function patchStreamingMessageRendering() {
    if (typeof messageRenderer === 'undefined') return;
    if (!messageRenderer || typeof messageRenderer.updateStreamingMessage !== 'function') return;
    if (messageRenderer.__tauMirrorStreamingPatched) return;

    messageRenderer.updateStreamingMessage = function (messageElement, content) {
      const contentDiv = messageElement.querySelector('.message-content');
      if (!contentDiv) return;

      let streamingTextNode = contentDiv.querySelector('.streaming-text');
      if (!streamingTextNode) {
        streamingTextNode = document.createElement('div');
        streamingTextNode.className = 'streaming-text';
        contentDiv.appendChild(streamingTextNode);
      }

      if (typeof messageRenderer.escapeHtml === 'function') {
        streamingTextNode.innerHTML = messageRenderer.escapeHtml(content);
      } else {
        streamingTextNode.textContent = content;
      }

      if (typeof messageRenderer.scrollToBottom === 'function') {
        messageRenderer.scrollToBottom();
      }
    };

    if (typeof messageRenderer.finalizeStreamingMessage === 'function') {
      const origFinalize = messageRenderer.finalizeStreamingMessage.bind(messageRenderer);
      messageRenderer.finalizeStreamingMessage = function (messageElement, usage, thinking) {
        const contentDiv = messageElement.querySelector('.message-content');
        if (contentDiv && !contentDiv.querySelector('.streaming-text')) {
          const st = document.createElement('div');
          st.className = 'streaming-text';
          contentDiv.appendChild(st);
        }
        return origFinalize(messageElement, usage, thinking);
      };
    }

    messageRenderer.__tauMirrorStreamingPatched = true;
  }

  patchSessionSwitchForMirrorPaths();
  patchStreamingMessageRendering();

  // Intercept handleMessage instead of onmessage to avoid double JSON.parse
  if (typeof wsClient.handleMessage === 'function') {
    const origHandleMessage = wsClient.handleMessage.bind(wsClient);
    wsClient.handleMessage = function (msg) {
      if (msg.type === 'event' && msg.event?.type === 'session_catalog_changed') {
        reloadSidebar();
        return;
      }
      if (msg.type === 'event' && msg.event?.__sessionFile) {
        if (!filterOrEnqueue(msg.event)) return;
      }
      const handled = origHandleMessage(msg);
      if (msg.type === 'mirror_sync') {
        alignKnownSessionFilePaths();
        syncActiveSessionForMirror(msg.forced === true);
      }
      return handled;
    };
  }

  const style = document.createElement('style');
  style.textContent = '.bg-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e74c3c;color:#fff;font-size:11px;font-weight:700;margin-left:auto}.session-item.has-bg-activity .session-title{color:#e74c3c}';
  document.head.appendChild(style);
})();
`;

// ---------------------------------------------------------------------------
// Proxy state
// ---------------------------------------------------------------------------

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
        try { client.close(); } catch {}
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
                        // Always send as text — browser ws.onmessage expects string
                        browserWs.send(typeof data === 'string' ? data : data.toString());
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
    // All ports busy — reject the promise
    if (proxyPortResolve) {
        proxyPortResolve(null);
        proxyPortResolve = null;
    }
}

// ---------------------------------------------------------------------------
// Session tracking — paths from oh-my-pi (always .omp)
// ---------------------------------------------------------------------------

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

/**
 * Notify the browser that a session should become the active/viewing session.
 * Used when the console creates a new session (e.g. /new) so the browser follows.
 * Sends a native-format mirror_sync with forced=true so the frontend knows
 * this is an explicit activation, not a background status sync.
 */
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

/**
 * Add a session file path to the known set.
 * Session paths from oh-my-pi are always .omp; identity matching
 * handles any .pi paths that tau-mirror might still produce.
 *
 * Marks catalog dirty on each observed session event and emits
 * session_catalog_changed in a short debounce window. If no browser
 * clients are connected at flush time, the dirty marker is preserved
 * and replayed on the next browser connection.
 */
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

// ---------------------------------------------------------------------------
// OMP session scanning — replaces tau-mirror's .pi-based scanning
// ---------------------------------------------------------------------------

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
                        const tb = content.find(b => b.type === 'text');
                        if (tb) firstMessage = tb.text.substring(0, 120);
                    }
                }
            }
        } catch { /* skip */ }
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
        const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
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
            } catch { /* skip */ }
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
                try { entries.push(JSON.parse(line)); } catch { /* skip */ }
            }
        }
    });

    stream.on('end', () => {
        if (buffer.trim()) {
            try { entries.push(JSON.parse(buffer)); } catch { /* skip */ }
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
        const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));

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
                                text = content.filter(b => b.type === 'text').map(b => b.text).join(' ');
                            }

                            if (!firstMessage && entry.message?.role === 'user' && text) {
                                firstMessage = text.substring(0, 120);
                            }

                            if (text && text.toLowerCase().includes(q)) {
                                const idx = text.toLowerCase().indexOf(q);
                                const start = Math.max(0, idx - 60);
                                const end = Math.min(text.length, idx + q.length + 60);
                                const snippet = (start > 0 ? '\u2026' : '') + text.substring(start, end) + (end < text.length ? '\u2026' : '');

                                matches.push({
                                    role: entry.message?.role || 'unknown',
                                    snippet: snippet.replace(/\n/g, ' '),
                                });

                                if (matches.length >= 3) break;
                            }
                        }
                    } catch { /* skip line */ }
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
            } catch { /* skip file */ }
        }
    }

    return { results };
}

// ---------------------------------------------------------------------------
// HTTP proxy
// ---------------------------------------------------------------------------

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
    // WebSocket upgrade — handled by the 'upgrade' event listener;
    // must not send an HTTP response or upgrade will be suppressed.
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return;

    if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders());
        res.end();
        return;
    }

    const urlPath = req.url.split('?')[0];

    // --- Session endpoints: served from ~/.omp directly ---
    // tau-mirror hardcodes .pi; we replace with .omp scanning.

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

    // --- All other requests: forward to upstream (tau-mirror) ---

    const body = req.method !== 'GET' && req.method !== 'HEAD' ? await collectBody(req) : undefined;
    const upstreamUrl = UPSTREAM_BASE() + req.url;
    const upstreamHeaders = buildUpstreamHeaders(req);
    const fetchOpts = { method: req.method, headers: upstreamHeaders };
    if (body && body.length > 0) fetchOpts.body = body;

    // /api/qr — rewrite tau-mirror URL to proxy URL
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

    // All other requests: forward to upstream
    const upstreamRes = await fetch(upstreamUrl, fetchOpts);

    // /app.js — needs tau-override appended
    if (urlPath === '/app.js') {
        const text = await upstreamRes.text();
        res.writeHead(upstreamRes.status, { 'Content-Type': 'application/javascript', ...corsHeaders() });
        res.end(text + INJECTED);
        return;
    }

    // Everything else: raw passthrough, no decoding
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
