# REF-03: Squad 引擎参考

> 路径：`../squad/`

## 目录结构

```
squad/
├── index.js              # 插件入口：命令注册、FSM、submit_plan 工具
├── shim.mjs              # ESM shim
├── squad-fsm.js          # Squad FSM (idle / active / revising)
├── state-machine.js      # 节点状态机（纯函数）
├── review-fsm.js         # 节点执行器（Worker/Reviewer/Confirm 会话）
├── dag-engine.js         # DAG 验证、拓扑排序、分层执行
├── outer-review.js       # L 模式外层 review
├── model-pool.js         # 模型池配置读写、ModelPool 类 (acquire/release)
├── view-manager.js       # 视图管理
├── test/
│   └── plugin.test.js    # 测试
├── README.md
└── SPEC.md
```

## 各文件关注点

### `index.js`

| 关注点 | 说明 |
|--------|------|
| `squadPlugin(pi)` | 默认导出，注册 `/squad` 和 `/squad-models` 命令 |
| `handleSquad()` | 解析用户任务 → 调用 agent 的 `submit_plan` 工具 |
| `submit_plan` 工具 | agent 提交 DAG plan，触发 `executeDAG` |
| `finishSquad()` | 完成后清理、记录结果 |
| SquadFSM | 管理 idle → active → revising 状态转换 |
| `validatePlan()` | 验证 `submit_plan` 参数的节点定义 |
| `generateModelsConfig()` | `/squad-models` 生成模型池初始配置 |

### `squad-fsm.js`

| API | 用途 |
|-----|------|
| `SquadFSM` class | 管理 squad 的三态 FSM（idle/active/revising） |

### `state-machine.js`

纯函数状态机，无副作用。

| 导出 | 用途 |
|------|------|
| `STATUS` | 状态常量：`WAITING_DEPS`/`PENDING`/`AUTHORING`/`CONFIRMING`/`REVIEWING`/`APPROVED`/`REJECTED`/`BLOCKED`/`FAILED` |
| `EVENT` | 事件常量：`START`/`WORKER_SUBMIT`/`CONFIRM`/`REVIEW_APPROVED`/`REVIEW_REJECTED`/`FAIL`/`BLOCK` |
| `transition(state, event)` | `(status, retryCount) × event → newState` |
| `emptyState(nodeId, hasDeps?)` | 创建初始状态（有依赖 → `WAITING_DEPS`，否则 → `PENDING`） |
| `MAX_RETRIES` | `Infinity`，无最大重试限制 |

### `review-fsm.js`

节点执行的完整生命周期。

| 导出 | 用途 |
|------|------|
| `runNode(node, upstreamResults, ctx, pi, signal, viewManager, modelPool)` | 完整节点生命周期入口 |
| `runWorker(node, upstreamResults, reviewerFeedback, …)` | Worker 执行 |
| `runConfirmSession(pi, workerOptions, confirmPrompt, signal, toolBuilders)` | Self-confirm |
| `runReviewer(node, workerResult, …)` | Reviewer 执行 |
| `buildWorkerPrompt(node, upstreamResults, reviewerFeedback)` | 构建 worker 提示词（含上游结果） |
| `buildConfirmPrompt(workerResult)` | 构建 confirm 提示词（用原始任务，非 worker 的 summary） |
| `buildReviewerPrompt(node, workerResult)` | 构建 reviewer 提示词 |

**lifecycle 工具**：
- `return_work({ summary, affected_files })` — Worker 提交结果
- `confirm({ comment? })` — Self-confirm 批准
- `approve({ comment? })` / `reject({ feedback })` — Reviewer 审批

**文件篡改检测**：
- `captureFileSnapshots(files, cwd)` — 记录 mtime 快照
- `filesChanged(snapshots, cwd)` — 检测 mtime 变化

**空轮次保护**：
- `MAX_EMPTY_TURNS = 20`（Worker）
- `CONFIRM_MAX_EMPTY = 5`（Confirm）

**模型分配**：
- 优先模型池，池空回落到当前会话模型

### `dag-engine.js`

| 导出 | 用途 |
|------|------|
| `validateNodes(nodes)` | 验证节点定义（重复 ID、未定义依赖） |
| `topologicalSort(nodes)` | 拓扑排序（检测循环依赖） |
| `executeDAG(nodes, ctx, pi, signal, viewManager)` | 完整 DAG 执行 |
| `FALLBACK_CONCURRENCY = 5` | 默认并发数 |

### `outer-review.js`

| 导出 | 用途 |
|------|------|
| `runOuterReview(nodes, results, originalTask, round, ctx, pi, signal, viewManager)` | 外层 review（L 模式所有节点完成后） |
| `buildTotalReviewerPrompt(nodes, results, originalTask, round)` | 构建聚合 review 提示词 |

**外层 review 流程**：
- 所有节点 approve 后启动
- approve → squad 完成
- reject → FSM 进入 `revising` → agent 重新 `submit_plan`
- 无最大轮次限制

### `model-pool.js`

| 导出 | 用途 |
|------|------|
| `loadModelsConfig()` | 读取 `~/.omp/squad/models.json` |
| `saveModelsConfig(config)` | 写入配置文件 |
| `ModelPool` class | acquire/release 等待队列 |
| `createModelPool(config)` | 工厂函数 |

**ModelPool API**：
- `acquire(role, signal)` → 返回 slot（含 provider, modelId），无空闲则等待
- `release()` → 释放槽位、唤醒等待队列
- 角色隔离：worker/reviewer 独立队列
- 删除使用中槽位 → `pending_delete` 标记，release 时真正删除

### `view-manager.js`

| 关注点 | 说明 |
|--------|------|
| 事件发布 | 通过 event-bus 发布 squad 和 session 事件，驱动 UI 更新 |
