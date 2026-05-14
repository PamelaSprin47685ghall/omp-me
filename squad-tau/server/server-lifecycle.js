import { createServer } from 'http';
import { createHttpServer } from './http-server.js';
import { createWsServer } from './ws-server.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { routeMessage } from './ws-handler.js';
import { EventBus } from './event-bus.js';
import { createViteDevServer, closeViteServer, CLIENT_ROOT } from './vite-setup.js';
import { ModelPool } from './model-pool.js';
import {
    loadModelsConfig,
    saveModelsConfig,
    watchConfig,
    unwatchConfig,
    syncModelPoolFromConfig,
} from './model-pool-config.js';
import { buildSnapshot } from './model-pool-events.js';
import { getCurrentRun, getSquadSnapshot } from './plugin-state.js';

let _server = null;
let _close = null;
let _refCount = 0;

function sendInitialSnapshot(ws, modelPool) {
    ws.send(
        JSON.stringify({
            type: 'model_pool:snapshot',
            payload: buildSnapshot(modelPool),
            timestamp: Date.now(),
        }),
    );
}

function replaySquadState(ws, squadSnap) {
    ws.send(
        JSON.stringify({
            type: 'squad:init',
            payload: { mode: squadSnap.mode, nodes: squadSnap.nodes, originalTask: squadSnap.originalTask },
            timestamp: Date.now(),
        }),
    );
    for (const node of squadSnap.nodes) {
        ws.send(
            JSON.stringify({
                type: 'squad:node_state',
                payload: { nodeId: node.id, status: node.status, retryCount: node.retryCount },
                timestamp: Date.now(),
            }),
        );
    }
    if (squadSnap.completed) {
        ws.send(
            JSON.stringify({
                type: 'squad:complete',
                payload: { results: squadSnap.results },
                timestamp: Date.now(),
            }),
        );
    }
}

function createConnectionHandler(modelPool, eventBus) {
    return (ws) => {
        sendInitialSnapshot(ws, modelPool);
        const squadSnap = getSquadSnapshot();
        if (squadSnap) replaySquadState(ws, squadSnap);
    };
}

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
    if (_server) return { port: _server.port, eventBus: _server.eventBus, modelPool: _server.modelPool, close: _close };

    const eventBus = new EventBus();
    const config = loadModelsConfig();
    const modelPool = new ModelPool(config);
    const rawServer = createServer();
    const viteMiddlewares = await createViteDevServer({ skipVite });
    const { wss, unsub } = await createWsServer(rawServer, eventBus, {
        onConnection: createConnectionHandler(modelPool, eventBus),
        onMessage: async (msg, ws) => {
            await routeMessage(msg, modelPool, { loadModelsConfig, saveModelsConfig }, eventBus, ws);
        },
    });
    const heartbeatCleanup = startHeartbeat(wss.clients);
    const http = await createHttpServer({ viteMiddlewares, server: rawServer, clientRoot: CLIENT_ROOT });
    const close = createCloseHandler(wss, rawServer, heartbeatCleanup, unsub);

    watchConfig(() => {
        syncModelPoolFromConfig(modelPool, loadModelsConfig());
        eventBus.emit('model_pool', 'changed', buildSnapshot(modelPool));
    });

    eventBus.on('squad:abort', () => {
        const run = getCurrentRun();
        if (run) run.abortController.abort();
    });

    _server = { port: http.port, eventBus, modelPool };
    _close = close;

    return { port: http.port, eventBus, modelPool, close };
}

export async function stopServer() {
    if (!_close) return;
    _refCount--;
    if (_refCount <= 0) {
        await _close();
        _refCount = 0;
    }
}

export function getGlobalEventBus() {
    return _server?.eventBus ?? null;
}
export function getGlobalModelPool() {
    return _server?.modelPool ?? null;
}
export function getServerPort() {
    return _server?.port ?? null;
}

export function closeServer() {
    return _close?.();
}
