# Squad-Tau PRD — 02 Squad 编排引擎

## 2.1 命令

| 命令 | 描述 |
|------|------|
| `/squad <task>` | 启动 squad 任务 |
| `/squad-models` | 生成初始模型池配置 |

## 2.2 执行模式

### M 模式（单节点）
- 适合内聚的多文件变更
- Agent 调用 `submit_plan({ mode: 'M', nodes: [{ id, task, review_criteria }] })`
- 流程：Worker → Self-Confirm → Reviewer → Approved

### L 模式（多节点 DAG）
- 适合模块化并行工作
- Agent 调用 `submit_plan({ mode: 'L', nodes: [{ id, task, review_criteria, depends_on }] })`
- 流程：拓扑排序 → 分层并发执行 → 外层 review 循环

## 2.3 节点生命周期

```
waiting_deps → pending → authoring → confirming → reviewing → approved
                                                            ↓
                                                         rejected → (retry)
                                                            ↓
                                                         blocked / failed
```

### 状态说明

| 状态 | 含义 |
|------|------|
| `waiting_deps` | 依赖未全部满足 |
| `pending` | 已就绪，等待执行 |
| `authoring` | Worker 正在工作 |
| `confirming` | Worker 自审中 |
| `reviewing` | Reviewer 审阅中 |
| `approved` | 节点通过 |
| `rejected` | 审阅未通过，可重试 |
| `blocked` | 依赖节点失败导致阻塞 |
| `failed` | Worker/Reviewer 异常 |

### 事件与转换

| 事件 | 从 → 到 |
|------|---------|
| `start` | `waiting_deps` → `pending` |
| `start` | `pending` → `authoring` |
| `worker_submit` | `authoring` → `confirming` |
| `confirm` | `confirming` → `reviewing` |
| `review_approved` | `reviewing` → `approved` |
| `review_rejected` | `reviewing` → `rejected` → `authoring` (retry) |
| `fail` | 任意 → `failed` |
| `block` | 任意 → `blocked` |

## 2.4 DAG 执行

- **拓扑排序**：根据 `depends_on` 确定执行顺序
- **分层并发**：同一层的节点并行执行（默认并发 5）
- **依赖传递**：上游节点的 `summary` 和 `affected_files` 传递给下游
- **失败传播**：如果某节点 failed/blocked，下游节点标记 `blocked`

## 2.5 外层 Review（L 模式）

- 所有节点完成后，启动外层 reviewer 会话
- 评估聚合结果是否满足原始任务
- 如果 reject：
  - FSM 转入 `revising` 状态
  - Agent 收到反馈，必须重新调用 `submit_plan`
  - `agent_end` hook 强制检查：revising 状态下 agent 试图结束轮次 → 发送强制消息
- **无最大轮次限制**，直到 approve 或用户手动 abort

## 2.6 Squad FSM

```
idle → active → revising → active → ... → idle
```

- `idle`：未激活，`submit_plan` 工具不活跃
- `active`：正在执行 DAG
- `revising`：外层 review reject，等待重新 submit_plan
