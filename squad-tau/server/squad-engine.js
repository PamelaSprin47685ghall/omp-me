import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { EventBus } from './event-bus.js';
import { createHttpServer } from './http-server.js';
import { createWsServer } from './ws-server.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { bridgeEventsToWebSocket } from './ws-events.js';
import { routeMessage } from './ws-handler.js';
import { createViteDevServer } from './vite-setup.js';
import { ModelPool } from './model-pool.js';
import {
    loadModelsConfig,
    saveModelsConfig,
    watchConfig,
    unwatchConfig,
    syncModelPoolFromConfig,
} from './model-pool-config.js';
import SquadFSM from './squad-fsm.js';
import { createSubmitPlanHandler } from './submit-plan.js';
import { executeDAG } from './dag-execute.js';
import { buildSnapshot } from './model-pool-events.js';
import { createOnCompleteHandler } from './squad-complete.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

export default function squadPlugin(pi) {
    pi.registerCommand({
        name: 'squad',
        description: 'Start a squad task with multi-agent orchestration',
        async handler(ctx) {
            const task = ctx.args.join(' ').trim();
            if (!task) {
                ctx.sendMessage('Usage: /squad <task description>');
                return;
            }

            const eventBus = new EventBus();
            const fsm = new SquadFSM();
            const abortController = new AbortController();
            const { signal } = abortController;

            let modelPool = null;
            let httpServer = null;
            let wsServer = null;

            try {
                const config = loadModelsConfig();
                modelPool = new ModelPool(config);

                const viteMiddlewares = await createViteDevServer();
                const httpResult = await createHttpServer({ viteMiddlewares });
                httpServer = httpResult.server;
                const port = httpResult.port;

                const wsResult = createWsServer(httpServer);
                wsServer = wsResult.wss;
                const wsClients = wsResult.wss.clients;

                startHeartbeat(wsClients);
                bridgeEventsToWebSocket(eventBus, wsClients);

                wsServer.on('connection', (ws) => {
                    ws.send(
                        JSON.stringify({
                            type: 'model_pool:snapshot',
                            payload: buildSnapshot(modelPool),
                            timestamp: Date.now(),
                        }),
                    );

                    ws.on('message', async (data) => {
                        try {
                            const msg = JSON.parse(data.toString());
                            if (msg.type === 'abort') {
                                eventBus.emit('squad', 'abort', { reason: 'User requested abort' });
                                abortController.abort();
                                return;
                            }
                            await routeMessage(msg, modelPool, { loadModelsConfig, saveModelsConfig }, eventBus, ws);
                        } catch (err) {
                            ws.send(
                                JSON.stringify({
                                    type: 'error',
                                    payload: { message: err.message },
                                    timestamp: Date.now(),
                                }),
                            );
                        }
                    });
                });

                watchConfig(() => {
                    syncModelPoolFromConfig(modelPool, loadModelsConfig());
                    eventBus.emit('model_pool', 'changed', buildSnapshot(modelPool));
                });

                ctx.sendMessage(`Squad UI: http://127.0.0.1:${port}`);

                const { SessionManager } = await getCodingAgentModule();
                const sessionManager = new SessionManager(pi);

                const startTime = Date.now();

                const submitPlanHandler = createSubmitPlanHandler({
                    fsm,
                    executeDAG: async ({ nodes }) => {
                        return await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });
                    },
                    ctx,
                    pi,
                    signal,
                    eventBus,
                    modelPool,
                    originalTask: task,
                    onComplete: createOnCompleteHandler({ task, ctx, pi, signal, eventBus, modelPool, fsm, startTime }),
                });

                const session = sessionManager.createAgentSession({
                    model: ctx.model,
                    cwd: ctx.cwd,
                    toolNames: ['read', 'write', 'edit', 'search', 'find', 'bash', 'lsp', 'eval'],
                    toolBuilders: {
                        submit_plan: () => submitPlanHandler,
                    },
                });

                fsm.activate();

                session.on('agent_end', () => {
                    if (fsm.state === 'revising') {
                        session.sendUserMessage(
                            'ERROR: You are in revising state. You must call submit_plan with the revised plan before ending.',
                        );
                    }
                });

                await session.prompt(
                    `Execute this task using the squad system. Analyze the task and call submit_plan with an appropriate plan (M mode for single cohesive work, L mode for parallelizable DAG):\n\n${task}`,
                );

                await session.settled;
            } catch (err) {
                if (err.name === 'AbortError') {
                    ctx.sendMessage('Squad aborted by user');
                } else {
                    ctx.sendMessage(`Squad error: ${err.message}`);
                    throw err;
                }
            } finally {
                unwatchConfig();
                if (wsServer) {
                    wsServer.close();
                }
                if (httpServer) {
                    httpServer.close();
                }
            }
        },
    });

    pi.registerCommand({
        name: 'squad-models',
        description: 'Generate initial model pool configuration',
        async handler(ctx) {
            const configPath = path.join(os.homedir(), '.omp/squad/models.json');
            const configDir = path.dirname(configPath);

            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            if (fs.existsSync(configPath)) {
                ctx.sendMessage(`Config already exists at ${configPath}`);
                return;
            }

            const defaultConfig = [
                { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', role: 'worker' },
                { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', role: 'reviewer' },
            ];

            saveModelsConfig(defaultConfig);
            ctx.sendMessage(`Created default model pool config at ${configPath}`);
        },
    });
}
