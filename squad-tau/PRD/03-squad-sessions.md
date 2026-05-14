# Squad-Tau PRD — 03 会话体系

## 3.1 工具注册策略

所有 lifecycle 工具通过 `pi.registerTool()` **全局注册**，所有 session 共享。

| 工具 | 签名 |
|------|------|
| `delegate` | `({ plan_dir: string })` — 提交 DAG 计划目录，每节点一个 `.toml`（文件名=节点ID）；单文件=M，多文件=L；`[[review_criteria]]` 含 `name` + `description` |
| `return` | `({ status: 'ok'\|'error', reason, affected_files? })` — 返回结果。语义因调用者而异（见 §3.2） |

## 3.2 Worker 生命周期（含 Self-Confirm）

Worker 和 Self-Confirm 共用**同一个 session 对象**。工具集在 `createAgentSession` 时固定，运行中不变更。

### return 调用契约

| 场景 | 调用 | 含义 |
|------|------|------|
| Worker 提交 | 第 1 次 `return({ status:'ok', ... })` | → 进入 self-confirm（Reactor 推导 `confirming`） |
| 自审通过 | 第 2 次 `return({ status:'ok', ... })` | → 完成，进入 reviewer（Reactor 推导 `reviewing`） |
| Worker 重做 | `return({ status:'error', reason })` | → 退回 worker 阶段重做 |
| Reviewer 驳回 | `return({ status:'error', reason })` | → 节点 rejected，retryCount++，退回 worker（Reactor 推导） |
| 主会话 redo | `return({ status:'error', reason })` | → 整个 squad 任务标识需重新 `delegate` |
| 外层 review 驳回 | approve=false 通过 delegate 返回值传递 | → Reactor 检测后重置所有节点回 authoring |

`return({ status:'ok' })` 的语义在所有场景一致：当前阶段完成，Reactor 在下一次 pulse 中通过规则推导下一阶段。

### Worker 提示词结构
1. 节点任务描述
2. 上游节点结果（summary + affected_files）
3. Reviewer 反馈（重试时）
4. `review_criteria` 逐条展开：`name: description`（description 原样嵌入）
5. 必须调用 `return` 的约束

### Self-Confirm 提示词结构（关键变化）
- **发回原始任务描述**，不是 worker 提交的 reason
- `review_criteria` 逐条展开：`name: description`
- 内置 review 维度：Code Quality / Design Flaws / Security / UX / Goal Completeness
- 如需修改，改完后再次调用 `return({ status: 'ok', ... })`

### 空轮次保护
两阶段**分别**计数：Worker authoring `MAX_EMPTY_TURNS = 20`，Self-Confirm `CONFIRM_MAX_EMPTY = 5`（`empty-turns.js` 定义）。

## 3.3 Reviewer 会话

### Session 策略
- **每次新 session**：每次 review 都创建全新的 session（`SessionManager.create()`），不复用之前任何 session
- 每个 retry 轮次都是全新的 reviewer session

### 可用工具
Reviewer session 工具集受限：`['read', 'search', 'find', 'lsp', 'bash', 'return']`（`run-reviewer.js` 中 `buildBaseSessionOptions` + 显式 `toolNames` 覆盖），不包含 `delegate` 和 `write`/`edit` 等写操作工具

### 生命周期
```typescript
return({ status: 'ok' | 'error', reason: string })
```
- `status: 'ok'` + `reason` → approve
- `status: 'error'` + `reason` → reject，附带反馈

### 提示词结构
1. 节点任务描述
2. Worker 提交的 `reason` + `affected_files`
3. `review_criteria` 逐条展开：`name: description`（description 原样嵌入，作为评审依据）
4. 内置 review 维度

## 3.4 节点完整执行流程

```mermaid
graph TD
    subgraph runWorker["同⼀ session"]
        direction TB
        W1["1. session.prompt(workerTask)"]
        W2["2. agent return(1st, status:'ok')"]
        W3["3. session.prompt(confirmPrompt)"]
        W4["4. agent 审查 / 修改文件"]
        W5["5. agent return(2nd, status:'ok')"]
        W1 --> W2 --> W3 --> W4 --> W5
    end

    subgraph Reactor[Reactor 推导]
        direction LR
        R1["检测 return → node_state: confirming"]
        R2["检测 return → node_state: reviewing"]
    end

    W2 --> R1
    W5 --> R2

    R1 --> runWorker

    subgraph runReviewer["每次新 session"]
        direction TB
        REV1["session.prompt(review)"]
        REV2{"return(status)"}
        REV1 --> REV2
        REV2 -->|status='ok'| DONE["Reactor → node_state: approved"]
        REV2 -->|status='error'| RETRY["Reactor → node_state: authoring\n(retryCount++)"]
    end

    R2 --> runReviewer
```

## 3.5 用户 Steer 消息

用户可以在 Web UI 中向任意活跃 session（主会话、Worker、Reviewer、OuterReview）发送消息，视为 steer（引导），实时指导 agent 工作方向。

### 覆盖范围

| Session 类型 | 可 steer | 说明 |
|-------------|----------|------|
| 主会话 | 是 | 常规对话，与终端中直接输入一致 |
| Worker | 是 | 在 authoring 阶段，用户可介入调整方向、补充上下文 |
| Reviewer | 是 | 在 reviewing 阶段，用户可补充审阅标准或提前给出反馈 |
| Self-Confirm | 是（但已合并进 worker phase） | agent 两次调用 return 之间，用户消息进入 worker 上下文 |
| OuterReview | 是 | 用户可向外层 reviewer 补充整体意见 |

### 路由机制

```
浏览器 WebSocket →  session:user_message {sessionId, text}  →  EventLog 追加
EventLog 触发 Engine Pulse  →  Reactor 检测  →  cmd:user_message  →  SideEffect 调用 session.prompt(text)
```

**关键区别**：用户消息不直接发送给 LLM，而是通过 EventLog 追加事实 → Engine Pulse → Reactor 推导 → SideEffect 执行。所有路径统一走 EventLog。

### 实现要点

- WebSocket 收到 `session:user_message` → 追加到 EventLog 两条：`session:message`（角色=user，用于 UI 同步）和 `session:user_message_received`（触发脉冲推导）
- Reactor 通过 EventLog 水位线检测新的 `session:user_message_received` → 推导 `cmd:user_message` → SideEffects 调用 `session.prompt(text)`
- 注入的消息先广播 `session:message`（role=user）到所有连接的浏览器，保持 UI 同步
- Worker/Reviewer session 收到用户消息后，agent 会将其视为任务上下文的一部分，可据此调整行为
- 用户消息不自动触发 squad 状态转换，但 agent 可能因此调用 lifecycle 工具（如 `return`、`delegate`）
- 已结束的 session（completed / aborted）拒绝接收用户消息，Web UI 会禁用输入框
- 用户消息在 session 的 JSONL 文件中正常记录，与终端输入的消息等效

## 3.6 消息事件桥接

session 事件通过 `session.subscribe(callback)` 订阅，回调接收原始事件对象而非命名事件。事件桥接在 `session-events.js` 中完成：

| session 事件 | WebSocket 事件类型 |
|-------------|-------------------|
| `message_update`（含 text_delta/thinking_delta） | `session:message_delta` |
| `tool_execution_start` | `session:tool_call` |
| `tool_execution_end` | `session:tool_result` |
| `message_end` | `session:message` |

这些事件直接追加到 EventLog（`message_delta` 和 `thinking_delta` 除外——它们仅是流式广播，不入持久日志）。

### 空轮次上限汇总

| 阶段 | 最大空轮次 | 代码常量 |
|------|-----------|---------|
| Worker authoring | 20 | `MAX_EMPTY_TURNS` |
| Self-Confirm | 5 | `CONFIRM_MAX_EMPTY` |
| Reviewer | 20 | `REVIEWER_MAX_EMPTY` |
| Outer Review | 20 | `OUTER_REVIEW_MAX_EMPTY` |
