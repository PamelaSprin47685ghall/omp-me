import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { executeDAG } from './dag-execute.js';
import { createOnCompleteHandler } from './squad-complete.js';
import { createViewManager } from './view-manager.js';
import SquadFSM from './squad-fsm.js';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';
import { startServer, getGlobalEventBus, getGlobalModelPool, getServerPort } from './server-lifecycle.js';
import { setCurrentRun, clearCurrentRun } from './plugin-state.js';
import { delegateTool, returnTool } from './lifecycle-tools.js';
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
}

async function runSquadSession(pi, ctx, task, fsm, eventBus) {
    const { SessionManager } = await getCodingAgentModule();
    const createAgentSession = pi?.pi?.createAgentSession;
    if (!createAgentSession) throw new Error('squad: createAgentSession unavailable');

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
    emitSquadSessionStart(eventBus, sessionId);

    try {
        await executeSquadPrompt(session, task, fsm);
    } catch (err) {
        handleSquadError(pi, err);
    } finally {
        cleanupSquadSession(unsubSessionEvents, sessionId, fsm);
    }
}

function emitSquadSessionStart(eventBus, sessionId) {
    eventBus.emit('session', 'start', { sessionId, phase: 'main' });
    eventBus.emit('session', 'state', { sessionId, phase: 'authoring' });
}

async function executeSquadPrompt(session, task, fsm) {
    const architectPrompt = `你现在是 Squad-Tau 架构师。用户交给了你一个总任务，你需要：
1. 分析任务，判断适合 M 模式（单节点）还是 L 模式（多节点 DAG）
2. 在系统临时目录（如 /tmp/squad-xxx）准备子任务描述文件
3. 每个节点一个 \`.toml\` 文件，文件名即节点 ID
4. 所有字段必填：
   - \`task\`：详细描述问题背景、最终目标、工作方法（例如 TDD）、参考材料、注意事项
   - \`depends_on\`：独立节点填 \`[]\`，依赖节点填其他文件名（不含 \`.toml\` 后缀）
   - \`[[review_criteria]]\`：每条含 \`name\` + \`description\`，description 要具体可检查

<code language="toml">
# login.toml
task = """
实现用户登录功能

- 问题背景 [此处省略 300 字]
- 最终目标 [此处省略 300 字]
- 工作方法 [此处省略 300 字]
- 参考材料 [此处省略 300 字]
- 注意事项 [此处省略 300 字]
"""
depends_on = ["main"]

[[review_criteria]]
name = "用户点击登录时弹出对话框"
description = "[此处省略 300 字]"

[[review_criteria]]
name = "登录失败时需要正确提示"
description = "[此处省略 300 字]"

[[review_criteria]]
name = "不得引入第三方未审计的密码存储"
description = "[此处省略 300 字]"
</code>

5. 完成后调用 \`delegate({ plan_dir: "/tmp/squad-xxx" })\` 提交

注意：\`task\` 描述必须尽可能详细，\`review_criteria\` 的 \`description\` 要具体可检查。

用户任务：
${task}`;

    await session.prompt(architectPrompt);
    await session.waitForIdle();

    let promptCount = 0;
    const MAX_ARCHITECT_PROMPTS = 3;
    while (fsm.isActive()) {
        if (fsm.isIdle()) break;
        promptCount++;
        if (promptCount > MAX_ARCHITECT_PROMPTS) {
            console.warn('[squad] Architect exceeded max prompt attempts, deactivating');
            fsm.deactivate();
            break;
        }
        await session.prompt(
            '错误：必须先调用 delegate 工具提交计划，不能直接结束。请调用 delegate({ plan_dir: "/tmp/squad-xxx" }) 提交计划。',
        );
        await session.waitForIdle();
    }
}

function handleSquadError(pi, err) {
    if (err.name === 'AbortError') pi.sendMessage('Squad aborted by user');
    else {
        pi.sendMessage(`Squad error: ${err.message}`);
        throw err;
    }
}

function cleanupSquadSession(unsub, sessionId, fsm) {
    unsub?.();
    if (sessionId) unregister(sessionId);
    fsm.deactivate();
    clearCurrentRun();
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
