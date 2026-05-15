/**
 * Squad-Tau HTTP/WS server lifecycle.
 * Manages server start/stop and global references.
 * EventLog-driven — no FSM, no SessionRegistry, no ModelPool class.
 * Dual-track protocol: fact channel (c:'f') + ephemeral channel (c:'e').
 * config:capacity_changed baked into EventLog — no separate env store/broadcast.
 *
 * Zero-State Bootstrapping: on startup, loads .ndjson into EventLog before
 * engine creation. The engine folds all persisted events, instantly rehydrating
 * the state tree to the pre-crash quantum.
 */
import { createServer } from 'http';
import { createHttpServer } from './http-server.js';
import { createWsServer, startHeartbeat } from './ws-server.js';
import { routeMessage } from './ws-handler.js';
import { EventLog } from './event-log.js';
import { createViteDevServer, closeViteServer, CLIENT_ROOT } from './vite-setup.js';
import { loadModelsConfig } from './model-pool.js';
import { setupEngine } from './engine.js';
import { loadFromNDJSON, createNDJSONWriter } from './persistence.js';

let _server = null;
let _close = null;
let _refCount = 0;

// ── Event horizon: only persistent macroscopic facts reach the client ──

const BROADCAST_WHITELIST = new Set([
    'squad:init',
    'squad:replan',
    'squad:phase_changed',
    'squad:node_state',
    'squad:complete',
    'squad:abort',
    'session:start',
    'session:state',
    'session:end',
    'session:faulted',
    'session:message',
    'message:created',
    'message:finalized',
    'tool_call:started',
    'tool_call:finished',
    'node:work_submitted',
    'node:review_decided',
    'config:capacity_changed',
    'connection:close',
    'pong',
    'error',
]);

function shouldBroadcast(eventType) {
    return BROADCAST_WHITELIST.has(eventType);
}

function createCloseHandler(wss, rawServer, heartbeatCleanup, unsub, ndjsonWriter) {
    let closing = false;
    return async () => {
        if (closing) return;
        closing = true;
        const closeMsg = JSON.stringify({
            c: 'f',
            event: 'connection:close',
            payload: { reason: 'server_stop' },
            timestamp: 0,
        });
        for (const client of wss.clients) client.send(closeMsg);
        heartbeatCleanup();
        unsub();
        ndjsonWriter.close();
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

    // Zero-state bootstrap: load persisted entries, seed EventLog
    const persistedEntries = loadFromNDJSON();
    const eventLog = new EventLog(persistedEntries);

    const config = loadModelsConfig();

    const rawServer = createServer();
    const viteMiddlewares = await createViteDevServer({ skipVite });
    const { wss } = await createWsServer(rawServer, null, {
        onConnection: () => {},
        onMessage: async (msg, ws) => {
            await routeMessage(msg, eventLog, ws, engine.getState);
        },
    });

    // ── NDJSON persistence writer — every fact goes to disk ──
    const ndjsonWriter = createNDJSONWriter();
    // Write any pre-loaded entries to the new file (in case it was lost/deleted)
    for (const entry of persistedEntries) {
        ndjsonWriter.write(entry);
    }
    const unsubPersist = eventLog.subscribe((data) => {
        ndjsonWriter.write(data);
    });

    // ── Broadcast helpers ──

    function broadcastEphemeral(event, payload, target) {
        const msg = JSON.stringify({ c: 'e', event, payload, ...(target ? { target } : {}) });
        for (const client of wss.clients) {
            if (client.readyState === 1) client.send(msg);
        }
    }

    const { EffectHandlers } = await import('./side-effects.js');
    const engine = setupEngine(eventLog, pi, config.maxWorkers || 3, EffectHandlers, broadcastEphemeral);

    // Pipe EventLog to WebSocket clients (fact channel, c:'f') with event horizon
    const unsubLog = eventLog.subscribe((data) => {
        const list = Array.isArray(data) ? data : [data];
        for (const entry of list) {
            if (!shouldBroadcast(entry.event)) continue;
            const msg = JSON.stringify({
                c: 'f',
                event: entry.event,
                payload: entry.payload,
                timestamp: entry.tick,
                seq: entry.id,
            });
            for (const client of wss.clients) {
                if (client.readyState === 1) client.send(msg);
            }
        }
    });

    const heartbeatCleanup = startHeartbeat(wss.clients);
    const http = await createHttpServer({ viteMiddlewares, server: rawServer, clientRoot: CLIENT_ROOT });
    const close = createCloseHandler(
        wss,
        rawServer,
        heartbeatCleanup,
        () => {
            unsubLog();
            unsubPersist();
            engine.cleanup();
        },
        ndjsonWriter,
    );

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
