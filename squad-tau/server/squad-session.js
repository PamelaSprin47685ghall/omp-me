import { getCodingAgentModule } from '@oh-my-pi/resolve-pi';
import { register, unregister } from './session-registry.js';
import { subscribeToSessionEvents } from './session-events.js';
import { clearCurrentRun } from './plugin-state.js';

function emitSquadSessionStart(eventBus, sessionId) {
    eventBus.emit('session', 'start', { sessionId, phase: 'main' });
    eventBus.emit('session', 'state', { sessionId, phase: 'authoring' });
}

function handleSquadAbort(session, fsm) {
    session?.abort?.();
    fsm.deactivate();
}

function handleSquadError(pi, session, fsm, err) {
    if (err.name === 'AbortError') {
        handleSquadAbort(session, fsm);
        pi.sendMessage('Squad aborted by user');
    } else {
        pi.sendMessage(`Squad error: ${err.message}`);
    }
}

function cleanupSquadSession(unsub, sessionId, fsm) {
    unsub?.();
    if (sessionId) unregister(sessionId);
    fsm.deactivate();
    clearCurrentRun();
}

const ARCHITECT_STATIC = `你现在是 Squad-Tau 架构师。用户交给了你一个总任务，你需要：
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
`;

function buildArchitectPrompt(task) {
    return ARCHITECT_STATIC + task;
}

async function waitForArchitectPlan(session, fsm, signal) {
    let promptCount = 0;
    const MAX_ARCHITECT_PROMPTS = 3;
    while (fsm.isActive()) {
        if (signal?.aborted) break;
        if (fsm.isIdle()) break;
        promptCount++;
        if (promptCount > MAX_ARCHITECT_PROMPTS) {
            throw new Error('Architect failed to submit a plan after multiple prompts');
        }
        if (signal?.aborted) break;
        await session.prompt(
            '错误：必须先调用 delegate 工具提交计划，不能直接结束。请调用 delegate({ plan_dir: "/tmp/squad-xxx" }) 提交计划。',
        );
        if (signal?.aborted) break;
        await session.waitForIdle();
    }
}

async function executeSquadPrompt(session, task, fsm, signal) {
    await session.prompt(buildArchitectPrompt(task));
    if (signal?.aborted) return;
    await session.waitForIdle();
    if (signal?.aborted) return;
    await waitForArchitectPlan(session, fsm, signal);
}

async function runSquadSession(pi, ctx, task, fsm, eventBus, signal) {
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

    if (signal) {
        signal.addEventListener('abort', () => session?.abort?.(), { once: true });
    }

    register(sessionId, {
        sendUserMessage: (text) => session.prompt(text),
        session,
        status: 'authoring',
    });

    const unsubSessionEvents = subscribeToSessionEvents(session, eventBus, sessionId);
    emitSquadSessionStart(eventBus, sessionId);

    try {
        await executeSquadPrompt(session, task, fsm, signal);
    } catch (err) {
        handleSquadError(pi, session, fsm, err);
    } finally {
        cleanupSquadSession(unsubSessionEvents, sessionId, fsm);
    }
}

export { runSquadSession, cleanupSquadSession, handleSquadError };
