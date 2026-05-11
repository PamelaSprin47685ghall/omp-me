import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { createDelegateHandler } from './submit-plan.js';
import { executeDAG } from './dag-execute.js';
import { createOnCompleteHandler } from './squad-complete.js';
import { buildGlobalReturnTool } from './lifecycle-tools.js';
import SquadFSM from './squad-fsm.js';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';
import { startServer, getGlobalEventBus, getGlobalModelPool, getServerPort } from './server-lifecycle.js';
import { setCurrentRun, clearCurrentRun, getCurrentRun } from './plugin-state.js';
import path from 'path';
import fs from 'fs';

export default function squadPlugin(pi) {
    const serverPromise = startServer();
    pi.registerTool(buildGlobalReturnTool());

    pi.registerTool({
        name: 'delegate',
        label: 'Delegate',
        description: 'Delegate execution by reading plan nodes from a directory of .toml files',
        parameters: {
            type: 'object',
            properties: {
                plan_dir: { type: 'string', description: 'Directory containing .toml node definition files' },
            },
            required: ['plan_dir'],
        },
        async execute(_id, params, _sig, _upd, _childCtx) {
            const run = getCurrentRun();
            if (!run) throw new Error('No active squad run');
            const handler = createDelegateHandler(run);
            return await handler.handler(params);
        },
    });

    pi.registerCommand({
        name: 'squad',
        description: 'Start a squad task with multi-agent orchestration',
        async handler(ctx) {
            const task = ctx.args.join(' ').trim();
            if (!task) return ctx.sendMessage('Usage: /squad <task description>');

            await serverPromise;
            const port = getServerPort();
            const eventBus = getGlobalEventBus();
            const modelPool = getGlobalModelPool();

            const fsm = new SquadFSM();
            const abortController = new AbortController();
            const { signal } = abortController;
            const startTime = Date.now();

            ctx.sendMessage(`Squad UI: http://127.0.0.1:${port}`);

            const { SessionManager } = await getCodingAgentModule();
            const createAgentSession = pi?.pi?.createAgentSession;
            if (!createAgentSession) throw new Error('squad: createAgentSession unavailable');

            const onComplete = createOnCompleteHandler({ ctx, fsm, eventBus });

            setCurrentRun({
                fsm,
                executeDAG: async ({ nodes }) => executeDAG({ nodes, ctx, pi, signal, eventBus, modelPool }),
                ctx,
                pi,
                signal,
                eventBus,
                modelPool,
                onComplete,
                originalTask: task,
                startTime,
                abortController,
            });

            fsm.activate();

            const sessionOpts = {
                model: ctx.model,
                cwd: ctx.cwd,
                hasUI: false,
                toolNames: ['read', 'write', 'edit', 'search', 'find', 'bash', 'lsp', 'eval', 'delegate', 'return'],
                sessionManager: SessionManager.create(ctx.cwd),
            };

            const { session } = await createAgentSession(sessionOpts);
            const sessionId = session.sessionFile;

            register(sessionId, {
                sendUserMessage: (text) => session.prompt(text),
                session,
                status: 'authoring',
            });

            const unsubSessionEvents = subscribeToSessionEvents(session, eventBus, sessionId);
            eventBus.emit('session', 'start', { sessionId, phase: 'main' });
            eventBus.emit('session', 'state', { sessionId, phase: 'authoring' });

            try {
                await session.prompt(
                    `Execute this task using the squad system. Analyze the task and call delegate with a directory containing .toml node definitions:\n\n${task}`,
                );

                while (fsm.isActive()) {
                    while (session.isStreaming) await new Promise((r) => setTimeout(r, 200));
                    if (session.settled) break;
                    if (fsm.isIdle()) break;
                    await session.prompt(
                        'ERROR: You MUST call delegate before ending. Do not output prose — call the tool.',
                    );
                }
                await session.settled;
            } catch (err) {
                if (err.name === 'AbortError') ctx.sendMessage('Squad aborted by user');
                else {
                    ctx.sendMessage(`Squad error: ${err.message}`);
                    throw err;
                }
            } finally {
                unsubSessionEvents?.();
                if (sessionId) unregister(sessionId);
                fsm.deactivate();
                clearCurrentRun();
            }
        },
    });

    pi.registerCommand({
        name: 'squad-models',
        description: 'Generate initial model pool configuration',
        async handler(ctx) {
            const configPath = path.join(ctx.cwd, '.omp', 'models.toml');
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
            if (fs.existsSync(configPath)) return ctx.sendMessage(`Config already exists at ${configPath}`);

            const defaultConfig = `[[slot]]\nprovider = "anthropic"\nmodel_id = "claude-3-5-sonnet-20241022"\nrole = "worker"\n\n[[slot]]\nprovider = "anthropic"\nmodel_id = "claude-3-5-sonnet-20241022"\nrole = "reviewer"\n`;
            fs.writeFileSync(configPath, defaultConfig, 'utf8');
            ctx.sendMessage(`Created default model pool config at ${configPath}`);
        },
    });
}
