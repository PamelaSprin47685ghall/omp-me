import { executeDAG } from './dag-execute.js';
import { createOnCompleteHandler } from './squad-complete.js';
import { createViewManager } from './view-manager.js';
import SquadFSM from './squad-fsm.js';
import { startServer } from './server-lifecycle.js';
import { setCurrentRun, setSquadSnapshot, getSquadSnapshot, clearSquadSnapshot } from './plugin-state.js';
import { delegateTool, returnTool } from './lifecycle-tools.js';
import { runSquadSession } from './squad-session.js';
import path from 'path';
import fs from 'fs';

export default function squadPlugin(pi) {
    pi.registerTool(delegateTool);
    pi.registerTool(returnTool);

    // Start HTTP+WebSocket server immediately on plugin load (PRD §7.2.1)
    const serverPromise = startServer().catch((err) => {
        console.error('[squad] Failed to start server:', err);
        return null;
    });

    let notified = false;
    pi.on('session_start', async (_event, ctx) => {
        if (notified) return;
        notified = true;
        const result = await serverPromise;
        if (result) {
            ctx.ui.setWorkingMessage(`Waiting — Squad UI: http://127.0.0.1:${result.port}`);
        }
    });

    registerSquadCommand(pi, () => serverPromise);
    registerSquadModelsCommand(pi);
}

function registerSquadCommand(pi, getServer) {
    pi.registerCommand('squad', {
        description: 'Start a squad task with multi-agent orchestration',
        async handler(args, ctx) {
            const task = typeof args === 'string' ? args.trim() : (args || []).join(' ').trim();
            if (!task) {
                pi.sendMessage('Usage: /squad <task description>');
                return;
            }

            const serverResult = await getServer();
            if (!serverResult) {
                pi.sendMessage('Failed to start squad server — check console for errors');
                return;
            }
            const { port, eventBus, modelPool } = serverResult;
            const fsm = new SquadFSM();
            const abortController = new AbortController();
            const { signal } = abortController;
            const startTime = Date.now();

            ctx.ui?.notify(`Squad UI: http://127.0.0.1:${port}`, 'info');

            const viewManager = createViewManager(eventBus, ctx);
            viewManager.start();

            const onComplete = createOnCompleteHandler({ pi, fsm, eventBus });

            setupCurrentRun({
                viewManager,
                fsm,
                ctx,
                pi,
                signal,
                eventBus,
                modelPool,
                onComplete,
                task,
                startTime,
                abortController,
            });

            fsm.activate();
            try {
                await runSquadSession(pi, ctx, task, fsm, eventBus);
            } finally {
                viewManager.cleanup();
            }
        },
    });
}

function setupCurrentRun({ fsm, ctx, pi, signal, eventBus, modelPool, onComplete, task, startTime, abortController }) {
    const run = {
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
        _unsubSnapshot: [],
    };

    if (eventBus) {
        run._unsubSnapshot.push(
            eventBus.on('squad:init', (payload) => {
                setSquadSnapshot({
                    mode: payload.mode,
                    nodes: payload.nodes.map((n) => ({
                        ...n,
                        status: n.depends_on?.length ? 'waiting_deps' : 'pending',
                        retryCount: 0,
                    })),
                    originalTask: payload.originalTask,
                    completed: false,
                    results: null,
                });
            }),
            eventBus.on('squad:node_state', (payload) => {
                const snap = getSquadSnapshot();
                if (!snap) return;
                const node = snap.nodes.find((n) => n.id === payload.nodeId);
                if (node) {
                    node.status = payload.status;
                    if (payload.retryCount !== undefined) node.retryCount = payload.retryCount;
                }
                setSquadSnapshot({ ...snap });
            }),
            eventBus.on('squad:complete', (payload) => {
                const snap = getSquadSnapshot();
                if (!snap) return;
                setSquadSnapshot({ ...snap, completed: true, results: payload.results });
            }),
            eventBus.on('squad:abort', clearSquadSnapshot),
        );
    }

    setCurrentRun(run);
}

function registerSquadModelsCommand(pi) {
    pi.registerCommand('squad-models', {
        description: 'Generate initial model pool configuration',
        async handler(args, ctx) {
            const configPath = path.join(ctx.cwd, '.omp', 'models.toml');
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
            if (fs.existsSync(configPath)) return pi.sendMessage(`Config already exists at ${configPath}`);

            const defaultConfig = `[[slot]]\nprovider = "anthropic"\nmodel_id = "claude-3-5-sonnet-20241022"\nrole = "worker"\n\n[[slot]]\nprovider = "anthropic"\nmodel_id = "claude-3-5-sonnet-20241022"\nrole = "reviewer"\n`;
            fs.writeFileSync(configPath, defaultConfig, 'utf8');
            pi.sendMessage(`Created default model pool config at ${configPath}`);
        },
    });
}
