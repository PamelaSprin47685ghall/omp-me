/**
 * MITM proxy — sits between the browser and tau-mirror.
 *
 * - Injects __sessionFile into WS events for multi-session routing
 * - Appends tau-override code to frontend JS
 * - Filters /api/sessions to only this process's sessions
 * - Runs on tauPort + 1000 (try offsets of 1000 if busy)
 */

import http from 'node:http';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
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

  function syncActiveSessionForMirror() {
    if (!mirrorActiveSessionFile) return;
    const isTrackingMirrorSession = !currentSessionFile || sameSessionFile(currentSessionFile, mirrorActiveSessionFile);
    if (!isTrackingMirrorSession) return;

    currentSessionFile = mirrorActiveSessionFile;
    const matchedSessionItem = findSessionItem(mirrorActiveSessionFile);
    if (matchedSessionItem?.dataset?.filePath) {
      currentSessionFile = matchedSessionItem.dataset.filePath;
    }
    if (typeof sidebar.setActive === 'function' && currentSessionFile) {
      sidebar.setActive(currentSessionFile);
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

      const thinkingBlock = contentDiv.querySelector('.streaming-thinking');
      let streamingTextNode = contentDiv.querySelector('.streaming-text');

      if (!streamingTextNode) {
        streamingTextNode = document.createElement('div');
        streamingTextNode.className = 'streaming-text';

        if (thinkingBlock) {
          contentDiv.appendChild(streamingTextNode);
        } else {
          contentDiv.innerHTML = '';
          contentDiv.appendChild(streamingTextNode);
        }
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
        syncActiveSessionForMirror();
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

export function setTauPort(port) {
    if (tauPort) return null;
    tauPort = port;
    proxyPortPromise = new Promise((resolve) => {
        proxyPortResolve = resolve;
    });
    startProxy();
    return proxyPortPromise;
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
    // WebSocket upgrade — handled by the 'upgrade' event listener below;
    // must not send an HTTP response or upgrade will be suppressed.
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return;

    if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders());
        res.end();
        return;
    }

    const body = req.method !== 'GET' && req.method !== 'HEAD' ? await collectBody(req) : undefined;
    const upstreamUrl = UPSTREAM_BASE() + req.url;
    const upstreamHeaders = buildUpstreamHeaders(req);
    const fetchOpts = { method: req.method, headers: upstreamHeaders };
    if (body && body.length > 0) fetchOpts.body = body;

    // /api/sessions — filter to this process's sessions
    if (req.url === '/api/sessions') {
        const upstreamRes = await fetch(upstreamUrl, fetchOpts);
        const data = await upstreamRes.json();
        filterSessions(data);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify(data));
        return;
    }

    // /api/qr — rewrite tau-mirror URL to proxy URL
    if (req.url === '/api/qr') {
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
    if (req.url === '/app.js') {
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

/** Session file paths known to this process (original + realpath-resolved). */
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
    const expandedSessionFile = expandSessionFile(sf);
    if (!expandedSessionFile) return null;
    try {
        return realpathSync(expandedSessionFile);
    } catch {
        return expandedSessionFile;
    }
}

export function isKnownSessionFile(sf) {
    const expandedSessionFile = expandSessionFile(sf);
    if (!expandedSessionFile) return false;
    if (knownSessions.has(expandedSessionFile)) return true;

    const normalizedSessionFile = normalizeSessionFile(sf);
    if (normalizedSessionFile && knownSessions.has(normalizedSessionFile)) return true;

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

/**
 * Add a session file path to the known set.
 * Expands ~ and resolves symlinks so paths from getSessionFile()
 * match what /api/sessions returns regardless of .pi vs .omp.
 */
export function addSessionFile(sf) {
    const expandedSessionFile = expandSessionFile(sf);
    const normalizedSessionFile = normalizeSessionFile(sf);
    if (!expandedSessionFile || !normalizedSessionFile) return;

    knownSessions.add(expandedSessionFile);
    knownSessions.add(normalizedSessionFile);

    const expandedSessionIdentity = getSessionIdentity(expandedSessionFile);
    const normalizedSessionIdentity = getSessionIdentity(normalizedSessionFile);
    if (expandedSessionIdentity) knownSessionIdentities.add(expandedSessionIdentity);
    if (normalizedSessionIdentity) knownSessionIdentities.add(normalizedSessionIdentity);

    if (knownSessionFiles.has(normalizedSessionFile)) return;
    knownSessionFiles.add(normalizedSessionFile);
    broadcastBrowserEvent({ type: 'session_catalog_changed', sessionFile: normalizedSessionFile });
}

function filterSessions(data) {
    if (!data.projects) return;
    for (const project of data.projects) {
        project.sessions = project.sessions.filter((session) => isKnownSessionFile(session.filePath));
    }
    data.projects = data.projects.filter((project) => project.sessions.length > 0);
}
