import { EventBus } from './event-bus.js';
import { createHttpServer } from './http-server.js';
import { createWsServer } from './ws-server.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { bridgeEventsToWebSocket } from './ws-events.js';
import { routeMessage } from './ws-handler.js';
import { createViteDevServer } from './vite-setup.js';
import { ModelPool } from './model-pool.js';
import { loadModelsConfig, saveModelsConfig, watchConfig, syncModelPoolFromConfig } from './model-pool-config.js';
import { buildSnapshot } from './model-pool-events.js';
import { getCurrentRun } from './plugin-state.js';

let globalEventBus = null;
let globalModelPool = null;
let httpServerInstance = null;
let wssInstance = null;
let heartbeatCleanup = null;
let bridgeCleanup = null;
let serverPort = null;

export async function startServer() {
    if (httpServerInstance) return { port: serverPort };

    globalEventBus = new EventBus();
    const config = loadModelsConfig();
    globalModelPool = new ModelPool(config);

    const viteMiddlewares = await createViteDevServer();
    const httpResult = await createHttpServer({ viteMiddlewares });
    httpServerInstance = httpResult.server;
    serverPort = httpResult.port;

    const wsResult = createWsServer(httpServerInstance, {
        onConnection: (ws) => {
            ws.send(
                JSON.stringify({
                    type: 'connection:established',
                    payload: { status: 'ok' },
                    timestamp: Date.now(),
                }),
            );
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

    heartbeatCleanup = startHeartbeat(wssInstance.clients);
    bridgeCleanup = bridgeEventsToWebSocket(globalEventBus, wssInstance.clients);

    watchConfig(() => {
        syncModelPoolFromConfig(globalModelPool, loadModelsConfig());
        globalEventBus.emit('model_pool', 'changed', buildSnapshot(globalModelPool));
    });

    globalEventBus.on('squad:abort', () => {
        const run = getCurrentRun();
        if (run) run.abortController.abort();
    });

    return { port: serverPort };
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
