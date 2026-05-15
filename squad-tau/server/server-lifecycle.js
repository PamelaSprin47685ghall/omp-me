/**
 * Squad-Tau HTTP/WS server lifecycle.
 * Manages server start/stop and global references.
 * EventLog-driven — no FSM, no SessionRegistry, no ModelPool class.
 * Dual-track protocol: fact channel (c:'f') + ephemeral channel (c:'e').
 */
import { createServer } from 'http';
import { createHttpServer } from './http-server.js';
import { createWsServer, startHeartbeat } from './ws-server.js';
import { routeMessage } from './ws-handler.js';
import { EventLog } from './event-log.js';
import { createViteDevServer, closeViteServer, CLIENT_ROOT } from './vite-setup.js';
import { loadModelsConfig } from './model-pool.js';
import { setupEngine } from './engine.js';

let _server = null;
let _close = null;
let _refCount = 0;

function createCloseHandler(wss, rawServer, heartbeatCleanup, unsub) {
    let closing = false;
    return async () => {
        if (closing) return;
        closing = true;
        const closeMsg = JSON.stringify({
            c: 'f',
            event: 'connection:close',
            payload: { reason: 'server_stop' },
            timestamp: Date.now(),
        });
        for (const client of wss.clients) client.send(closeMsg);
        heartbeatCleanup();
        unsub();
        for (const client of wss.clients) client.terminate();
        wss.close();
        if (typeof rawServer.closeAllConnections === 'function') rawServer.closeAllConnections();
        await new Promise((r) => rawServer.close(() => r()));
        await closeViteServer();
        _server = null;
        _close = null;
    };
}

export async function startServer({ pi, skipVite = false } = {}) {
    _refCount++;
    if (_server) return { port: _server.port, eventLog: _server.eventLog, close: _close };

    const eventLog = new EventLog();
    const config = loadModelsConfig();

    const rawServer = createServer();
    const viteMiddlewares = await createViteDevServer({ skipVite });
    const { wss } = await createWsServer(rawServer, null, {
        onConnection: () => {
            // Send env snapshot on new connection
            broadcastEnv();
        },
        onMessage: async (msg, ws) => {
            const result = await routeMessage(msg, eventLog, ws, engine.getState, engine.setEnv);
            // Broadcast env changes to all clients
            if (result?.__envChanged) {
                broadcastEnv();
            }
        },
    });

    // ── Broadcast helpers ──

    function broadcastEphemeral(event, payload, target) {
        const msg = JSON.stringify({ c: 'e', event, payload, ...(target ? { target } : {}) });
        for (const client of wss.clients) {
            if (client.readyState === 1) client.send(msg);
        }
    }

    // Env is separate from EventLog — no model_pool:snapshot pollution
    // Wire effect handlers (PA: return facts, no EventLog access)
    const { EffectHandlers } = await import('./side-effects.js');
    const engine = setupEngine(
        eventLog,
        pi,
        { maxWorkers: config.maxWorkers || 3 },
        EffectHandlers,
        broadcastEphemeral,
    );

    function broadcastEnv() {
        const env = engine.getEnv();
        const msg = JSON.stringify({
            c: 'f',
            event: 'squad:env',
            payload: { maxWorkers: env.maxWorkers },
        });
        for (const client of wss.clients) {
            if (client.readyState === 1) client.send(msg);
        }
    }

    // Pipe EventLog to WebSocket clients (fact channel, c:'f')
    // Handles both single entries and batch arrays
    const unsubLog = eventLog.subscribe((data) => {
        const list = Array.isArray(data) ? data : [data];
        for (const entry of list) {
            const msg = JSON.stringify({
                c: 'f',
                event: entry.event,
                payload: entry.payload,
                timestamp: entry.timestamp,
                seq: entry.id,
            });
            for (const client of wss.clients) {
                if (client.readyState === 1) client.send(msg);
            }
        }
    });

    const heartbeatCleanup = startHeartbeat(wss.clients);
    const http = await createHttpServer({ viteMiddlewares, server: rawServer, clientRoot: CLIENT_ROOT });
    const close = createCloseHandler(wss, rawServer, heartbeatCleanup, () => {
        unsubLog();
        engine.cleanup();
    });

    // Broadcast env after setup
    broadcastEnv();

    _server = { port: http.port, eventLog };
    _close = close;

    return { port: http.port, eventLog, close };
}

export async function stopServer() {
    if (!_close) return;
    _refCount--;
    if (_refCount <= 0) {
        await _close();
        _refCount = 0;
    }
}

export function getGlobalEventLog() {
    return _server?.eventLog ?? null;
}
export function getServerPort() {
    return _server?.port ?? null;
}

export function closeServer() {
    return _close?.();
}
