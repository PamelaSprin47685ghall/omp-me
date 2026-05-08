/**
 * MITM proxy — sits between the browser and tau-mirror.
 *
 * - Injects __sessionFile into WS events for multi-session routing
 * - Appends tau-override code to frontend JS
 * - Filters /api/sessions to only this process's sessions
 * - Runs on tauPort + 1000 (try offsets of 1000 if busy)
 */

import http from 'node:http';
import { realpathSync } from 'node:fs';
import { WebSocketServer, WebSocket as WsClient } from 'ws';

// ---------------------------------------------------------------------------
// tau-override: appended to app.js before the browser receives it
// ---------------------------------------------------------------------------
const INJECTED = `

// === tau-override: multi-session routing ===
(() => {
  let currentSessionFile = null;
  const bgQueues = new Map();

  // Track which session the user is viewing via sidebar clicks
  sidebar.container.addEventListener('click', (e) => {
    const item = e.target.closest('.session-item');
    if (item) {
      currentSessionFile = item.dataset.filePath;
      flushBg(currentSessionFile);
    }
  });

  function filterOrEnqueue(ev) {
    const sf = ev.__sessionFile;
    if (!sf) return true;
    if (!currentSessionFile || sf === currentSessionFile) return true;
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
    const item = document.querySelector('.session-item[data-file-path="' + sf.replace(/"/g, '&quot;') + '"]');
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
    const item = document.querySelector('.session-item[data-file-path="' + sf.replace(/"/g, '&quot;') + '"]');
    if (!item) return;
    const badge = item.querySelector('.bg-badge');
    if (badge) badge.remove();
    item.classList.remove('has-bg-activity');
  }

  // Intercept WebSocket onmessage to filter background events
  let proxyWs = null;
  function hookWs(ws) {
    if (!ws || ws === proxyWs) return;
    proxyWs = ws;
    const orig = ws.onmessage;
    ws.onmessage = function (event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'event' && msg.event?.__sessionFile) {
          if (!filterOrEnqueue(msg.event)) return;
        }
      } catch {}
      return orig.call(this, event);
    };
  }

  hookWs(wsClient.ws);
  const origConnect = wsClient.connect.bind(wsClient);
  wsClient.connect = function () {
    origConnect();
    const check = setInterval(() => {
      if (wsClient.ws && wsClient.ws !== proxyWs) { hookWs(wsClient.ws); clearInterval(check); }
    }, 50);
    setTimeout(() => clearInterval(check), 5000);
  };

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
                        try {
                            upstreamWs.close();
                        } catch {}
                    });
                    upstreamWs.on('error', () => browserWs.close());
                    browserWs.on('error', () => {
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

/**
 * Add a session file path to the known set.
 * Stores both the original path and (if the file exists) the realpath-resolved
 * version, so ~/.pi/... and ~/.omp/... match the same session.
 */
export function addSessionFile(sf) {
    if (!sf) return;
    knownSessions.add(sf);
    try {
        knownSessions.add(realpathSync(sf));
    } catch {}
}

function filterSessions(data) {
    if (!data.projects) return;
    for (const project of data.projects) {
        project.sessions = project.sessions.filter((s) => {
            if (knownSessions.has(s.filePath)) return true;
            try {
                return knownSessions.has(realpathSync(s.filePath));
            } catch {}
            return false;
        });
    }
    data.projects = data.projects.filter((p) => p.sessions.length > 0);
}
