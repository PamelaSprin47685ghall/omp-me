import { createServer } from 'http';
import { createHttpServer } from './http-server.js';
import { createWsServer } from './ws-server.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { routeMessage } from './ws-handler.js';
import { EventBus } from './event-bus.js';
import { createViteDevServer, closeViteServer } from './vite-setup.js';
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

export async function startServer() {
    _refCount++;
    if (_server) return { port: _server.port, eventBus: _server.eventBus, modelPool: _server.modelPool };

    const eventBus = new EventBus();
    const config = loadModelsConfig();
    const modelPool = new ModelPool(config);

    // 1. Create the raw HTTP server first (before binding, no request handler yet).
    const rawServer = createServer();

    // 2. Create Vite dev server middleware (HMR disabled; no WS conflict).
    const viteMiddlewares = await createViteDevServer();

    // 3. Create the WS server on the same raw server.
    const { wss, unsub } = createWsServer(rawServer, eventBus, {
        onConnection: (ws) => {
            ws.send(
                JSON.stringify({
                    type: 'model_pool:snapshot',
                    payload: buildSnapshot(modelPool),
                    timestamp: Date.now(),
                }),
            );

            const squadSnap = getSquadSnapshot();
            if (squadSnap) {
                ws.send(
                    JSON.stringify({
                        type: 'squad:init',
                        payload: {
                            mode: squadSnap.mode,
                            nodes: squadSnap.nodes,
                            originalTask: squadSnap.originalTask,
                        },
                        timestamp: Date.now(),
                    }),
                );
                for (const node of squadSnap.nodes) {
                    ws.send(
                        JSON.stringify({
                            type: 'squad:node_state',
                            payload: {
                                nodeId: node.id,
                                status: node.status,
                                retryCount: node.retryCount,
                            },
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
        },
        onMessage: async (msg, ws) => {
            await routeMessage(msg, modelPool, { loadModelsConfig, saveModelsConfig }, eventBus, ws);
        },
    });

    // 4. Start heartbeat before creating close handler (avoids hoisting issue).
    const heartbeatCleanup = startHeartbeat(wss.clients);

    // 5. Now add our request handler (with Vite middleware + status endpoint) and bind.
    const http = await createHttpServer({ viteMiddlewares, server: rawServer });
    const close = async () => {
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

        // Close the HTTP server first so Vite's async dep-scan requests
        // fail at the connection level (ECONNREFUSED) instead of hitting
        // a closed middleware that throws "server is being restarted".
        if (typeof rawServer.closeAllConnections === 'function') rawServer.closeAllConnections();
        await new Promise((r) => rawServer.close(() => r()));

        // Then close Vite (no more pending requests to race against).
        await closeViteServer();

        _server = null;
        _close = null;
    };

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
