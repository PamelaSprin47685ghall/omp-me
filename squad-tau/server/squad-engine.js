import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { EventBus } from './event-bus.js';
import { createHttpServer } from './http-server.js';
import { createWsServer } from './ws-server.js';
import { startHeartbeat } from './ws-heartbeat.js';
import { bridgeEventsToWebSocket } from './ws-events.js';
import { routeMessage } from './ws-handler.js';
import { createViteDevServer } from './vite-setup.js';
import { ModelPool } from './model-pool.js';
import { loadModelsConfig, saveModelsConfig, watchConfig, unwatchConfig } from './model-pool-config.js';
import SquadFSM from './squad-fsm.js';
import { createSubmitPlanHandler } from './submit-plan.js';
import { executeDAG } from './dag-execute.js';
import { runOuterReview } from './outer-review.js';
import { buildSnapshot } from './model-pool-events.js';
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
            let clients = null;

            try {
                const config = loadModelsConfig();
                modelPool = new ModelPool(config);

                const viteMiddlewares = await createViteDevServer();
                const httpResult = await createHttpServer({ viteMiddlewares });
                httpServer = httpResult.server;
                const port = httpResult.port;

                const wsResult = createWsServer(httpServer);
                wsServer = wsResult.wss;
                clients = wsResult.clients;

                startHeartbeat(clients);
                bridgeEventsToWebSocket(eventBus, clients);

                wsServer.on('connection', (ws) => {
                    ws.send(
                        JSON.stringify({
                            type: 'connection:established',
                            payload: { serverVersion: '1.0.0' },
                            timestamp: Date.now(),
                        }),
                    );

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
                                eventBus.emit('squad:abort', { reason: 'User requested abort' });
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
                    const newConfig = loadModelsConfig();
                    modelPool = new ModelPool(newConfig);
                    eventBus.emit('model_pool:changed', buildSnapshot(modelPool));
                });

                ctx.sendMessage(`Squad UI: http://127.0.0.1:${port}`);

                const { SessionManager } = await getCodingAgentModule();
                const sessionManager = new SessionManager(pi);

                const startTime = Date.now();
                let dagResult = null;

                const submitPlanHandler = createSubmitPlanHandler({
                    fsm,
                    executeDAG: async (nodes) => {
                        dagResult = await executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool });
                        return dagResult;
                    },
                    ctx,
                    pi,
                    signal,
                    eventBus,
                    modelPool,
                    onComplete: async (result) => {
                        if (result.mode === 'L') {
                            const nodeResults = result.nodes.map((n) => ({
                                id: n.id,
                                status: n.status,
                                summary: n.summary || '',
                                affectedFiles: n.affectedFiles || [],
                            }));

                            const outerReviewResult = await runOuterReview(
                                nodeResults,
                                task,
                                result.round || 1,
                                ctx,
                                pi,
                                signal,
                                eventBus,
                                modelPool,
                                startTime,
                            );

                            if (outerReviewResult.verdict === 'rejected') {
                                fsm.revise();
                                ctx.sendMessage(
                                    `Outer review rejected (round ${result.round || 1}). Please revise and resubmit.`,
                                );
                                if (outerReviewResult.feedback) {
                                    ctx.sendMessage(`Feedback: ${outerReviewResult.feedback}`);
                                }
                            } else {
                                fsm.deactivate();
                                const duration = Date.now() - startTime;
                                eventBus.emit('squad:complete', { results: nodeResults, durationMs: duration });
                                ctx.sendMessage(`Squad completed successfully in ${(duration / 1000).toFixed(1)}s`);
                            }
                        } else {
                            fsm.deactivate();
                            const duration = Date.now() - startTime;
                            const nodeResults = result.nodes.map((n) => ({
                                id: n.id,
                                status: n.status,
                                summary: n.summary || '',
                                affectedFiles: n.affectedFiles || [],
                            }));
                            eventBus.emit('squad:complete', { results: nodeResults, durationMs: duration });
                            ctx.sendMessage(`Squad completed successfully in ${(duration / 1000).toFixed(1)}s`);
                        }
                    },
                });

                const session = sessionManager.createAgentSession({
                    model: ctx.model,
                    cwd: ctx.cwd,
                    toolNames: ['read', 'write', 'edit', 'search', 'find', 'bash', 'lsp', 'eval'],
                    toolBuilders: {
                        submit_plan: () => ({
                            name: 'submit_plan',
                            description: 'Submit a squad execution plan',
                            parameters: {
                                type: 'object',
                                properties: {
                                    mode: { type: 'string', enum: ['M', 'L'] },
                                    nodes: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                id: { type: 'string' },
                                                task: { type: 'string' },
                                                review_criteria: {
                                                    oneOf: [
                                                        { type: 'string' },
                                                        { type: 'array', items: { type: 'string' } },
                                                    ],
                                                },
                                                depends_on: { type: 'array', items: { type: 'string' } },
                                            },
                                            required: ['id', 'task', 'review_criteria'],
                                        },
                                    },
                                },
                                required: ['mode', 'nodes'],
                            },
                            handler: submitPlanHandler,
                        }),
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

            const defaultConfig = {
                slots: [
                    { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', role: 'worker' },
                    { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', role: 'reviewer' },
                ],
            };

            saveModelsConfig(defaultConfig);
            ctx.sendMessage(`Created default model pool config at ${configPath}`);
        },
    });
}
