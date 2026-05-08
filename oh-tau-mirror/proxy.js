/**
 * MITM proxy — sits between the browser and tau-mirror.
 *
 * - Injects __sessionFile into WS events for multi-session routing
 * - Appends tau-override code to frontend JS
 * - Filters /api/sessions to only this process's sessions
 * - Runs on tauPort + 1000 (try offsets of 1000 if busy)
 */

import http from 'node:http';
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
let processSessions = null;

export function setProcessSessions(sessions) {
  processSessions = sessions;
}

export function getProxyStatus() {
  if (!proxyServer) return null;
  const addr = proxyServer.address();
  return addr ? { port: addr.port } : null;
}

export function setTauPort(port) {
  if (tauPort) return;
  tauPort = port;
  startProxy();
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
        if (req.url !== '/ws') { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (browserWs) => {
          const upstreamWs = new WsClient(`ws://127.0.0.1:${tauPort}/ws`);

          upstreamWs.on('open', () => {
            // Both sides connected: start bidirectional forwarding
          });

          upstreamWs.on('message', (data) => browserWs.send(data));
          browserWs.on('message', (data) => upstreamWs.send(data));

          upstreamWs.on('close', () => browserWs.close());
          browserWs.on('close', () => { try { upstreamWs.close(); } catch {} });
          upstreamWs.on('error', () => browserWs.close());
          browserWs.on('error', () => { try { upstreamWs.close(); } catch {} });
        });
      });

      proxyServer.listen(port, '0.0.0.0');
      return;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP proxy
// ---------------------------------------------------------------------------

const UPSTREAM_BASE = () => `http://127.0.0.1:${tauPort}`;

async function proxyHandler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    res.end();
    return;
  }

  const upstreamUrl = UPSTREAM_BASE() + req.url;

  // Filter /api/sessions to this process's sessions
  if (req.url === '/api/sessions') {
    const upstreamRes = await fetch(upstreamUrl);
    const data = await upstreamRes.json();
    filterSessions(data);
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify(data));
    return;
  }

  // All other requests: proxy upstream
  const upstreamRes = await fetch(upstreamUrl);
  const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
  let body = await upstreamRes.text();

  // Append tau-override to app.js
  if (req.url === '/app.js') {
    body += INJECTED;
  }

  const headers = { 'Content-Type': contentType, ...corsHeaders() };
  if (upstreamRes.status === 304) {
    res.writeHead(304, headers);
    res.end();
  } else {
    res.writeHead(upstreamRes.status, headers);
    res.end(body);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function filterSessions(data) {
  if (!processSessions || !data.projects) return;
  for (const project of data.projects) {
    project.sessions = project.sessions.filter(s => processSessions.has(s.filePath));
  }
  data.projects = data.projects.filter(p => p.sessions.length > 0);
}
