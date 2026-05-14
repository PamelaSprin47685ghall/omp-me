/**
 * Squad-Tau HTTP/WS server lifecycle.
 * Manages server start/stop and global references.
 * EventLog-driven — no FSM, no SessionRegistry, no ModelPool class.
 */
import { createServer } from 'http';
import { createHttpServer } from './http-server.js';
import { createWsServer } from './ws-server.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { routeMessage } from './ws-handler.js';
import { EventLog } from './event-log.js';
import { createViteDevServer, closeViteServer, CLIENT_ROOT } from './vite-setup.js';
import {
    loadModelsConfig,
    saveModelsConfig,
    watchConfig,
    unwatchConfig,
    syncModelPoolFromConfig,
} from './model-pool-config.js';
import { buildSnapshot } from './model-pool-events.js';
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
            type: 'connection:close',
            payload: { reason: 'server_stop' },
            timestamp: Date.now(),
        });
        for (const client of wss.clients) client.send(closeMsg);
        heartbeatCleanup();
        unsub();
        unwatchConfig();
        for (const client of wss.clients) client.terminate();
        wss.close();
        if (typeof rawServer.closeAllConnections === 'function') rawServer.closeAllConnections();
        await new Promise((r) => rawServer.close(() => r()));
        await closeViteServer();
        _server = null;
        _close = null;
    };
}

export async function startServer({ skipVite = false } = {}) {
    _refCount++;
    if (_server) return { port: _server.port, eventLog: _server.eventLog, close: _close };

    const eventLog = new EventLog();
    const config = loadModelsConfig();

    // Initialize model pool slots via EventLog (no ModelPool class)
    eventLog.append('model_pool:snapshot', {
        slots: config.map((s, i) => ({
            ...s,
            slotId: s.slotId || `slot-${i}-${s.role}-${s.provider}-${s.modelId}`,
        })),
    });

    const engine = setupEngine(eventLog, { pi: globalThis.PI });

    const rawServer = createServer();
    const viteMiddlewares = await createViteDevServer({ skipVite });
    const { wss } = await createWsServer(rawServer, null, {
        onConnection: (ws) => {
            const missing = eventLog.getSince(0);
            for (const event of missing) {
                ws.send(
                    JSON.stringify({
                        type: event.event,
                        payload: event.payload,
                        timestamp: event.timestamp,
                        seq: event.id,
                    }),
                );
            }
        },
        onMessage: async (msg, ws) => {
            await routeMessage(msg, { loadModelsConfig, saveModelsConfig }, eventLog, ws, engine.getState);
        },
    });

    // Pipe eventLog to WebSocket clients
    const unsubLog = eventLog.subscribe((entry) => {
        const msg = JSON.stringify({
            type: entry.event,
            payload: entry.payload,
            timestamp: entry.timestamp,
            seq: entry.id,
        });
        for (const client of wss.clients) {
            if (client.readyState === 1) client.send(msg);
        }
    });

    const heartbeatCleanup = startHeartbeat(wss.clients);
    const http = await createHttpServer({ viteMiddlewares, server: rawServer, clientRoot: CLIENT_ROOT });
    const close = createCloseHandler(wss, rawServer, heartbeatCleanup, () => {
        unsubLog();
        engine.cleanup();
    });

    watchConfig((newConfig) => {
        syncModelPoolFromConfig(eventLog, newConfig, engine.getState);
        eventLog.append('model_pool:changed', buildSnapshot(engine.getState()));
    });

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
