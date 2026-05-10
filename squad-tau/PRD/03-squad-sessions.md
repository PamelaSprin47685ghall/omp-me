# Squad-Tau PRD — 03 会话体系

## 3.1 Worker 会话

### 可用工具
`executeBash`, `read`, `write`, `edit`, `search`, `find`, `lsp`, `eval`

### Lifecycle 工具
```typescript
return_work({ summary: string, affected_files: string[] })
```

### 提示词结构
1. 节点任务描述
2. 上游节点结果（`summary` + `affected_files`，附带 `read` 指令）
3. Reviewer 反馈（重试时）
4. 必须调用 `return_work` 的约束

### 空轮次保护
- `MAX_EMPTY_TURNS = 20`
- 连续 20 轮无工具调用 → 强制提醒 `ERROR: You must call the required tool`

### 事件订阅
- Worker 会话的所有内部事件（message, tool_call, tool_result, thinking_delta）通过 `session.subscribe` 捕获
- 转发到 WebSocket → 浏览器实时显示

## 3.2 Self-Confirm 会话

### 复用策略
- **复用 Worker 的同一个 session**（不是创建新 session）
- 保持相同的 `sessionFile`

### Lifecycle 工具
```typescript
confirm({ comment?: string })
return_work({ summary: string, affected_files: string[] })  // 重新提交
```

### 提示词结构（关键变化）
- ⚠ **发回原始任务描述**，不是 worker 提交的 summary
- 内置 review 维度：
  1. Code Quality — 是否正确、清晰、符合惯例？
  2. Design Flaws — 是否有架构问题、紧耦合？
  3. Security Vulnerabilities — 注入、权限绕过、数据泄露？
  4. User Experience — 调用方是否能正确使用？
  5. Goal Completeness — 是否完整满足需求？
- 如果做了任何变更，必须调用 `return_work` 重新提交

### 文件篡改检测
```
Worker return_work → 捕获 affected_files 的 mtime 快照
         ↓
Confirm 阶段监听从 confirm prompt 发送后 有没有文件被修改
         ↓
  如果 mtime 变化 → 抛出 SQUAD_TAMPERED 错误 → 自动重试
  如果 agent 调用 return_work → 更新快照，继续 confirm 循环
```

### 空轮次保护
- `CONFIRM_MAX_EMPTY = 5`

## 3.3 Reviewer 会话

### 可用工具
- `read`, `search`, `find`, `lsp`, `bash`（只读，不可写文件）
- 审查者不得修改任何代码

### Lifecycle 工具
```typescript
approve({ comment?: string })
reject({ feedback: string })
```

### 提示词结构
1. 节点任务描述
2. Worker 提交的 `summary` + `affected_files`
3. 用户指定的 `review_criteria`
4. 内置 review 维度

## 3.4 节点完整执行流程

```
                    ┌─────────────────────────────┐
                    │      modelPool.acquire       │
                    │       ('worker', signal)      │
                    └──────────┬──────────────────┘
                               ↓
                    ┌─────────────────────────────┐
                    │        runWorker             │
                    │  → createAgentSession        │
                    │  → inject return_work tool   │
                    │  → session.prompt(task)      │
                    │  → wait for settled          │
                    └──────────┬──────────────────┘
                               ↓ (workerResult)
                    ┌─────────────────────────────┐
                    │      captureFileSnapshots    │
                    └──────────┬──────────────────┘
                               ↓
                    ┌─────────────────────────────┐
                    │      runConfirmSession       │
                    │  → reuse session             │
                    │  → inject confirm/return_work│
                    │  → session.prompt(confirm)   │
                    │  → wait for settled          │
                    └──────────┬──────────────────┘
                    ┌──────────┴──────────────────┐
                    │  confirm  │  return_work     │
                    │  (approve)│  (resubmit)      │
                    └────┬─────┴──────┬───────────┘
                         ↓            ↓
                   check tamper   update snapshot
                         ↓            ↓
                    ┌──────────┐     ┌───────────┐
                    │  proceed │     │  re-run    │
                    │ to review│     │  confirm   │
                    └────┬─────┘     └───────────┘
                         ↓
                    ┌─────────────────────────────┐
                    │     modelPool.acquire        │
                    │     ('reviewer', signal)      │
                    └──────────┬──────────────────┘
                               ↓
                    ┌─────────────────────────────┐
                    │       runReviewer            │
                    │  → createAgentSession        │
                    │  → inject approve/reject     │
                    │  → session.prompt(review)    │
                    │  → wait for settled          │
                    └──────────┬──────────────────┘
                    ┌──────────┴──────────────────┐
                    │  approve   │  reject         │
                    │  → done    │  → retry        │
                    └───────────┘  (increment      │
                                   retryCount)     │
                                   └───────────────┘
```

## 3.5 用户 Steer 消息

用户可以在 Web UI 中向任意活跃 session（主会话、Worker、Reviewer、OuterReview）发送消息，视为 steer（引导），实时指导 agent 工作方向。

### 覆盖范围

| Session 类型 | 可 steer | 说明 |
|-------------|----------|------|
| 主会话 | 是 | 常规对话，与终端中直接输入一致 |
| Worker | 是 | 在 authoring 阶段，用户可介入调整方向、补充上下文 |
| Reviewer | 是 | 在 reviewing 阶段，用户可补充审阅标准或提前给出反馈 |
| Self-Confirm | 否 | 复用 worker session，用户消息进入 worker 上下文 |
| OuterReview | 是 | 用户可向外层 reviewer 补充整体意见 |

### 路由机制

```
浏览器 WebSocket                          pi.sendUserMessage(sessionId, text)
  session:user_message  ─────────→  ┌─────────────────────┐
  { sessionId, text }               │  ws-server: 按 sessionId  │
                                    │  查找对应 session，调用 │
                                    │  pi.sendUserMessage()    │
                                    └─────────────────────┘
                                               │
                                               ↓
                                    session 处理消息，事件流
                                    (message_delta, tool_call,
                                     tool_result, message)
                                    通过 event-bus → WebSocket 广播
```

### 实现要点

- WebSocket 收到 `session:user_message` → 服务器按 `sessionId` 找到对应 session → 调用 `pi.sendUserMessage()`
- 注入的消息先广播 `session:message`（role=user）到所有连接的浏览器，保持 UI 同步
- Worker/Reviewer session 收到用户消息后，agent 会将其视为任务上下文的一部分，可据此调整行为
- 用户消息不自动触发 squad 状态转换，但 agent 可能因此调用 lifecycle 工具（如 `return_work`、`approve`、`reject`）
- 已结束的 session（completed / aborted）拒绝接收用户消息，Web UI 会禁用输入框
- 用户消息在 session 的 JSONL 文件中正常记录，与终端输入的消息等效

### 与 Self-Review 的关系

Self-review 消息能正常发给 session 说明 OMP 的 `sendUserMessage` 通道畅通。用户 steer 本质上是同一机制通过 WebSocket 暴露给 Web UI，不引入新的 session 管理逻辑。

```
                    ┌─────────────────────────────┐
                    │      modelPool.acquire       │
                    │       ('worker', signal)      │
                    └──────────┬──────────────────┘
                               ↓
                    ┌─────────────────────────────┐
                    │        runWorker             │
                    │  → createAgentSession        │
                    │  → inject return_work tool   │
                    │  → session.prompt(task)      │
                    │  → wait for settled          │
                    └──────────┬──────────────────┘
                               ↓ (workerResult)
                    ┌─────────────────────────────┐
                    │      captureFileSnapshots    │
                    └──────────┬──────────────────┘
                               ↓
                    ┌─────────────────────────────┐
                    │      runConfirmSession       │
                    │  → reuse session             │
                    │  → inject confirm/return_work│
                    │  → session.prompt(confirm)   │
                    │  → wait for settled          │
                    └──────────┬──────────────────┘
                    ┌──────────┴──────────────────┐
                    │  confirm  │  return_work     │
                    │  (approve)│  (resubmit)      │
                    └────┬─────┴──────┬───────────┘
                         ↓            ↓
                   check tamper   update snapshot
                         ↓            ↓
                    ┌──────────┐     ┌───────────┐
                    │  proceed │     │  re-run    │
                    │ to review│     │  confirm   │
                    └────┬─────┘     └───────────┘
                         ↓
                    ┌─────────────────────────────┐
                    │     modelPool.acquire        │
                    │     ('reviewer', signal)      │
                    └──────────┬──────────────────┘
                               ↓
                    ┌─────────────────────────────┐
                    │       runReviewer            │
                    │  → createAgentSession        │
                    │  → inject approve/reject     │
                    │  → session.prompt(review)    │
                    │  → wait for settled          │
                    └──────────┬──────────────────┘
                    ┌──────────┴──────────────────┐
                    │  approve   │  reject         │
                    │  → done    │  → retry        │
                    └───────────┘  (increment      │
                                   retryCount)     │
                                   └───────────────┘
```
