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
import { createDelegateHandler } from './submit-plan.js';
import { executeDAG } from './dag-execute.js';
import { buildSnapshot } from './model-pool-events.js';
import { createOnCompleteHandler } from './squad-complete.js';
import { subscribeToSessionEvents } from './session-events.js';
import { register, unregister } from './session-registry.js';
import path from 'path';
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
                    const send = (type, payload) => ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
                    send('model_pool:snapshot', buildSnapshot(modelPool));
                    ws.on('message', async (data) => {
                        try {
                            const msg = JSON.parse(data.toString());
                            if (msg.type === 'abort') {
                                eventBus.emit('squad', 'abort', { reason: 'User requested abort' });
                                return abortController.abort();
                            }
                            await routeMessage(msg, modelPool, { loadModelsConfig, saveModelsConfig }, eventBus, ws);
                        } catch (err) {
                            send('error', { message: err.message });
                        }
                    });
                });

                watchConfig(() => {
                    syncModelPoolFromConfig(modelPool, loadModelsConfig());
                    eventBus.emit('model_pool', 'changed', buildSnapshot(modelPool));
                });

                ctx.sendMessage(`Squad UI: http://127.0.0.1:${port}`);

                const { SessionManager } = await getCodingAgentModule();
                const createAgentSession = pi?.pi?.createAgentSession;
                if (!createAgentSession) {
                    throw new Error('squad: createAgentSession unavailable');
                }

                const startTime = Date.now();

                const delegateHandler = createDelegateHandler({
                    fsm,
                    executeDAG: async ({ nodes }) => executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool }),
                    ctx,
                    pi,
                    signal,
                    eventBus,
                    modelPool,
                    originalTask: task,
                    startTime,
                    onComplete: createOnCompleteHandler({ ctx, fsm, eventBus }),
                });

                fsm.activate();

                const sessionOpts = {
                    model: ctx.model,
                    cwd: ctx.cwd,
                    hasUI: false,
                    toolNames: ['read', 'write', 'edit', 'search', 'find', 'bash', 'lsp', 'eval'],
                    customTools: [delegateHandler],
                    sessionManager: SessionManager.create(ctx.cwd),
                };

                const { session } = await createAgentSession(sessionOpts);
                const sessionId = session.sessionFile;

                register(sessionId, {
                    sendUserMessage: (text) => session.prompt(text),
                    session,
                    status: 'authoring',
                });

                let unsubSessionEvents = null;
                if (eventBus) {
                    eventBus.emit('session', 'start', { sessionId, phase: 'main' });
                    eventBus.emit('session', 'state', { sessionId, phase: 'authoring' });
                    unsubSessionEvents = subscribeToSessionEvents(session, eventBus, sessionId);
                }

                try {
                    await session.prompt(
                        `Execute this task using the squad system. Analyze the task and call delegate with a directory containing .toml node definitions:\n\n${task}`,
                    );

                    // Agent turn loop — handles outer review rejection feedback
                    while (fsm.isActive() || fsm.isRevising()) {
                        while (session.isStreaming) await new Promise((r) => setTimeout(r, 200));
                        if (session.settled) break;
                        if (fsm.isRevising()) {
                            await session.prompt(
                                'ERROR: Outer review rejected your submission. You MUST call delegate with a revised plan before ending. Do not output prose — call the tool.',
                            );
                        } else if (fsm.isIdle()) break;
                    }

                    await session.settled;
                } finally {
                    if (unsubSessionEvents) unsubSessionEvents();
                    if (sessionId) unregister(sessionId);
                }
            } catch (err) {
                if (err.name === 'AbortError') ctx.sendMessage('Squad aborted by user');
                else {
                    ctx.sendMessage(`Squad error: ${err.message}`);
                    throw err;
                }
            } finally {
                fsm.deactivate();
                unwatchConfig();
                if (wsServer) wsServer.close();
                if (httpServer) httpServer.close();
            }
        },
    });

    pi.registerCommand({
        name: 'squad-models',
        description: 'Generate initial model pool configuration',
        async handler(ctx) {
            const configPath = path.join(ctx.cwd, '.omp', 'models.toml');
            const configDir = path.dirname(configPath);

            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            if (fs.existsSync(configPath)) {
                ctx.sendMessage(`Config already exists at ${configPath}`);
                return;
            }

            const defaultConfig = `[[slot]]
provider = "anthropic"
model_id = "claude-3-5-sonnet-20241022"
role = "worker"

[[slot]]
provider = "anthropic"
model_id = "claude-3-5-sonnet-20241022"
role = "reviewer"
`;

            fs.writeFileSync(configPath, defaultConfig, 'utf8');
            ctx.sendMessage(`Created default model pool config at ${configPath}`);
        },
    });
}
