# Squad-Tau PRD — 02 Squad 编排引擎

**核心哲学**：DAG 的推进不靠遍历树，不靠拓扑排序，不靠分层并发控制。而是基于节点 `status` 的**声明式规则推导**。

## 2.1 命令

| 命令 | 描述 |
|------|------|
| `/squad <task>` | 向 LLM 下达任务，要求准备 `.toml` 文件并调用 `delegate`；强制 LLM 不得静默结束 |
| `/squad-models` | 生成初始模型池配置 |

> `/squad` **不启动任何服务**。HTTP/WS 服务器在插件加载时即启动，Web UI 始终可用。`delegate` 工具全局注册，LLM 可随时自主调用。

## 2.2 执行模式

### M 模式（单节点）
- 适合内聚的多文件变更
- 目录中只有一个 `.toml` 文件
- 流程：Worker → Self-Confirm → Reviewer → Approved

### L 模式（多节点 DAG）
- 适合模块化并行工作
- 目录中有多个 `.toml` 文件
- 流程：Reactor 根据依赖规则推导节点流转 → 外层 review 循环

## 2.3 节点生命周期 — 声明式规则表

**这不是状态机**。这些规则是 Reactor 纯函数内部的条件分支。Reactor 每次被调用时，对每个活跃节点逐一检查这些规则，输出对应的 Action。

### 依赖规则

| 条件（全部满足） | 结论 | 说明 |
|----------------|------|------|
| `node.status === undefined` | → emit `node_state: idle` | 初始状态声明 |
| `node.status === idle` && 所有上游已 approved | → emit `node_state: authoring` | 依赖满足，可执行 |
| `node.status !== idle` && 上游有 failed/blocked | → emit `node_state: blocked` | 依赖断阻 |
| `node.status === idle` && 上游未全部满足 | 无 action | 等待 |

### 阶段推进规则

| 当前 status | 条件 | 结论 |
|------------|------|------|
| `authoring` | session 中存在 `return({status:'ok'})` | → emit `node_state: confirming` |
| `confirming` | session 中存在 `return({status:'ok'})` | → emit `node_state: reviewing` |
| `reviewing` | session 中存在 `return({status:'ok'})` | → emit `node_state: approved` |
| `reviewing` | session 中存在 `return({status:'error'})` + retryCount < MAX_RETRIES | → emit `node_state: authoring`（重试） |
| `reviewing` | session 中存在 `return({status:'error'})` + retryCount >= MAX_RETRIES | → emit `node_state: failed` |

### 外层 Review 规则

| 条件 | 结论 |
|------|------|
| 所有节点已 approved（L 模式） | → emit `squad:outer_review_start`（首次） |
| 外层 review 已 rejected + 任一节点有 retryCount > 0 | → emit `squad:outer_review_start`（新一轮） |
| 外层 review 已 rejected + 所有节点 retryCount === 0 | → 重置所有节点为 `authoring`（+retryCount） |
| 外层 review 已 approved | → emit `squad:complete` |

### 并发规则（无队列）

| 条件 | 结论 |
|------|------|
| 节点进入 authoring/confirming/reviewing，需要 worker 模型 | 检查 `state.modelPool.usage` 中该角色空闲槽位 |
| 有空闲槽位 | → emit `model_pool:acquire` |
| 无空闲槽位 | 静默等待——下次 pulse 再次检查 |
| 该角色槽位数为 0（未配置） | 跳过 acquire，直接 → emit `cmd:create_session` |
| 模型已分配但无 session | → emit `cmd:create_session` |

**并发的自然收敛**：无需队列、无需信号量。Reactor 计算 `Available = slotCount - usage.length`，若有正数差值则推导对应数量的 acquire 动作。release 同理——节点终结时 Reactor 扫描 usage 中失效条目，推导 release。

## 2.4 delegate 参数

```typescript
delegate({ plan_dir: string })
```

`plan_dir` 指向一个目录，内含每个节点一个 `.toml` 文件。Agent 先在临时目录准备这些文件，再调用 `delegate`。

- 目录中 **只有一个** `.toml` 文件 → **M 模式**（单节点）
- 目录中 **有多个** `.toml` 文件 → **L 模式**（多节点 DAG）

### 节点文件格式（文件名即节点 ID）
```toml
# auth-base.toml
task = "Implement authentication base layer..."
depends_on = []

[[review_criteria]]
name = "Correctness"
description = "Handles all edge cases correctly"

[[review_criteria]]
name = "Security"
description = "No injection or auth bypass"

# login.toml
task = "Build login UI..."
depends_on = ["auth-base"]

[[review_criteria]]
name = "Design"
description = "Follows design system"
```

### 字段约束

| 字段 | 类型 | 说明 |
|------|------|------|
| `task` | string | **必须详细具体**，包含问题背景、目标、工作方法（如 TDD）、参考材料、注意事项等。LLM 准备文件时应尽可能细致 |
| `depends_on` | string[] | **M 模式不允许**（`validate-plan.js` 会报错）；L 模式必填，独立节点填 `[]`，依赖节点填其他文件名（不含 `.toml` 后缀） |
| `review_criteria` | table[] 或 string[] 或 string | 可接受 `{name, description}` 对象数组、字符串数组或纯字符串 |

### 设计理由
- 避免 LLM 输出截断（复杂 plan 可拆到多个 `.toml` 文件）
- 文件数决定 M/L 模式，无需额外配置
- LLM 使用系统临时目录准备

## 2.5 节点终端状态

| 状态 | 触发条件 | 下游影响 |
|------|----------|----------|
| `approved` | Reviewer 返回 `status:'ok'` | 依赖此节点的下游解锁 |
| `failed` | 达到 `MAX_RETRIES`（默认 5）或非可恢复错误 | 下游全部变为 `blocked` |
| `blocked` | Reactor 检测到上游依赖有 failed/blocked | 自动推导，无需手动设置 |

## 2.6 外层 Review（L 模式）

- 所有节点 `approved` 后，Reactor 自动推导 `squad:outer_review_start`
- 评估聚合结果是否满足原始任务
- 如果 reject：重置所有节点回 `authoring`（retryCount++），新一轮外层 review
- **无最大轮次限制**，直到 approve 或用户手动 abort

## 2.7 Squad 活跃状态

| 状态 | 含义 | 核心区别 |
|------|------|----------|
| `idle` | 无活跃任务。LLM 可静默结束 | EventLog 中无活跃 squad |
| `active` | 有活跃任务 | Reactor 处于推导循环中 |

`idle` 与 `active` 的区别通过 `state.squad.status` 反映—Reactor 在 `status !== 'active'` 时直接返回 `[]`。

## 2.8 实际约束

| 参数 | 值 |
|------|----|
| `MAX_RETRIES` | 5（`constants.js` 中 `DEFAULTS.MAX_RETRIES = 5`） |
| `MAX_EMPTY_TURNS`（Worker） | 20 |
| `CONFIRM_MAX_EMPTY` | 5（独立于 Worker） |
| `REVIEWER_MAX_EMPTY` | 20 |
| `OUTER_REVIEW_MAX_EMPTY` | 20 |
