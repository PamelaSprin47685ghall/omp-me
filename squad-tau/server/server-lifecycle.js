import { EventBus } from './event-bus.js';
import { createHttpServer } from './http-server.js';
import { createWsServer } from './ws-server.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { routeMessage } from './ws-handler.js';
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
import { getCurrentRun } from './plugin-state.js';

let globalEventBus = null;
let globalModelPool = null;
let httpServerInstance = null;
let wssInstance = null;
let heartbeatCleanup = null;
let bridgeCleanup = null;
let serverPort = null;
let serverPromise = null;

export async function startServer() {
    if (httpServerInstance) return { port: serverPort };
    if (serverPromise) return serverPromise;

    serverPromise = (async () => {
        if (httpServerInstance) return { port: serverPort };
        globalEventBus = new EventBus();
        const config = loadModelsConfig();
        globalModelPool = new ModelPool(config);

        const viteMiddlewares = await createViteDevServer();
        const httpResult = await createHttpServer({ viteMiddlewares });
        httpServerInstance = httpResult.server;
        serverPort = httpResult.port;

        const wsResult = createWsServer(httpServerInstance, globalEventBus, {
            onConnection: (ws) => {
                ws.send(
                    JSON.stringify({
                        type: 'model_pool:snapshot',
                        payload: buildSnapshot(globalModelPool),
                        timestamp: Date.now(),
                    }),
                );
            },
            onMessage: async (msg, ws) => {
                await routeMessage(msg, globalModelPool, { loadModelsConfig, saveModelsConfig }, globalEventBus, ws);
            },
        });
        wssInstance = wsResult.wss;
        bridgeCleanup = wsResult.unsub;

        heartbeatCleanup = startHeartbeat(wssInstance.clients);

        watchConfig(() => {
            syncModelPoolFromConfig(globalModelPool, loadModelsConfig());
            globalEventBus.emit('model_pool', 'changed', buildSnapshot(globalModelPool));
        });

        globalEventBus.on('squad:abort', () => {
            const run = getCurrentRun();
            if (run) run.abortController.abort();
        });

        return { port: serverPort };
    })();

    return serverPromise;
}

export async function stopServer() {
    if (wssInstance) {
        const closeMsg = JSON.stringify({
            type: 'connection:close',
            payload: { reason: 'server_stop' },
            timestamp: Date.now(),
        });
        for (const client of wssInstance.clients) {
            client.send(closeMsg);
        }
    }
    await closeViteServer();
    if (heartbeatCleanup) {
        heartbeatCleanup();
        heartbeatCleanup = null;
    }
    if (bridgeCleanup) {
        bridgeCleanup();
        bridgeCleanup = null;
    }
    unwatchConfig();
    if (wssInstance) {
        for (const client of wssInstance.clients) {
            client.terminate();
        }
        wssInstance.close();
        wssInstance = null;
    }
    if (httpServerInstance) {
        if (typeof httpServerInstance.closeAllConnections === 'function') {
            httpServerInstance.closeAllConnections();
        }
        await new Promise((resolve) => httpServerInstance.close(() => resolve()));
        httpServerInstance = null;
    }
    globalEventBus = null;
    globalModelPool = null;
    serverPort = null;
    serverPromise = null;
}

export function getGlobalEventBus() {
    return globalEventBus;
}
export function getGlobalModelPool() {
    return globalModelPool;
}
export function getServerPort() {
    return serverPort;
}
