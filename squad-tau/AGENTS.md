# Squad-Tau 项目要求

注意运行 bash 命令和测试必须设置尽可能短的超时，防止把自己卡住！切记！

## 代码约束

- 超过 40 行的单函数，必须合理拆解成很多函数和模块
- 超过 200 行的文件，必须合理拆解成很多文件
- 纯 JavaScript（JSX），无 TypeScript
- 所有图标使用 lucide-react SVG 图标

### 数据流铁律

- **绝对的数据流单向性**。SideEffects 禁止包含任何 `async/await` 业务挂起。副作用必须是 Fire-and-Forget，结果仅通过向全局 EventLog 追加事实来反馈。
- **禁止历史扫描（No History Scanning）**。Reactor 绝对禁止调用 `eventLog.getSince()` 或 `.find()` 扫描历史。一切推导只能基于 `shared/projections.js` 折叠后的扁平 `State` 对象。Reactor 的函数签名必须是 `f(state) → Action[]`，其中 state 是纯投影树，无日志引用。
- **O(1) 数据铁律**。所有依赖查找、状态获取必须是 `state.nodes[id]` 这样的 O(1) 哈希映射。在 60FPS 渲染循环或 Reactor 推导循环中，绝对禁止使用数组 `.filter()`、`.map()` 或字符串 `.split()`。数据必须是`键 → 值`的平坦结构，任何 O(n) 遍历都不允许存在于热路径。
- **禁止兜底**。出现兜底就是掩盖根因，必须追踪到消息 ID 为何缺失、状态为何丢失，在源头修复。
- **不要防御性编程**。`if (x) x.startsWith(...)` 这种代码说明上游契约被破坏，去上游修。

### 禁用词汇（Lexicon Ban）

以下词汇在本项目中永久禁用。新文档、代码注释、变量命名、内部讨论中均不得使用：

| 禁用词 | 禁用原因 | 正确替代 |
|--------|----------|----------|
| 状态机实例 (FSM Instance) | 隐含了手动流转的图模型 | Engine Pulse + Reactor 推导 |
| 事件总线 (EventBus) | 总线是连接组件的中介，层级扁平不推演 | EventLog 追加订阅 |
| 挂起 (Suspend) | 暗示异步等待队列 | 上下文切换到 Engine 微任务 |
| 等待队列 (Wait Queue) | 队列是命令式原语 | 静态计数 | `countLiveSessions(state) < maxWorkers` |
| 编排器 (Orchestrator) | 编排器主动"拉动"流程 | Reactor 纯函数推导 "推动" |
| 拓扑排序 (Topological Sort) | 排序是批处理思维，不适用于增量事件流 | 声明式依赖规则 (Reactor 条件) |
| 防抖节流定时器 (Debounce/Throttle Timers) | 定时器掩盖事件分发问题 | 微任务批处理 (queueMicrotask) |
| 命令 / 意图 (Command) | 系统中不存在指令，只有"已经发生的事实" | 过渡态事实 (Transitional Fact) |
| UUID / 随机 ID | 随机 ID 意味着不可追踪、不可重放、不可断言 | 确定性 URN (`NodeId::Phase::Retry`) |
| acquire / release (申请/释放) | 将并发管理拟人化，掩盖代数本质 | 不等式比较 (`countLive < maxWorkers`) |
| `useState` / `Context` (前端) | React 禁止维护任何局部业务状态 | `EventStore` 折叠 + `useSyncExternalStore` |

## 核心架构

系统由四大模块构成，严格遵循单向数据流。注意 **SideEffects 不受 Reactor 直接调用**——它是 EventLog 的无声订阅者，听到过渡态事实便自行行动。

```mermaid
graph TD
    subgraph Truth
        EL[(EventLog\nAppend-Only Facts)]
    end
    subgraph Nervous System
        PROJ((Projections\nIncremental Fold))
    end
    subgraph Brain
        REACT{Reactor\nPure f(State)}
    end
    subgraph Muscle
        SE[Side Effects\nEventLog Subscriber]
    end
    subgraph UI
        DOM[React View\nf(State)]
    end

    EL -->|1. Trigger Pulse| PROJ
    PROJ -->|2. Emit State| REACT
    PROJ -->|Sync| DOM
    REACT -->|3. Yield Transitional Facts| EL
    SE -.->|4. Silently reads| EL
    SE -->|5. Call APIs| OMP[LLM / FS]
    OMP -->|6. Async Callbacks| EL
```

**这是系统的宇宙公理**。所有组件围绕 EventLog（不可变事实日志）组成纯函数推导闭环。系统中不存在"指令"——只有已经发生的事实（Fact）、正在发生的事实（Transitional Fact）、和尚未推导的未来事实。没有流程控制，只有数据、规则、和副作用。

| 模块 | 文件 | 职责 | 禁止行为 |
|------|------|------|----------|
| **真理源** | `server/event-log.js` | 全局追加式不可变事实日志 | 不允许删除/修改/回滚已有条目 |
| **物化视图** | `shared/projections.js` | 纯函数增量折叠：`f(prevState, Event) → nextState` | 不允许有 side effect、不查日志 |
| **推导大脑** | `server/reactor.js` | 纯函数：`f(State) → Action[]` | 不允许调用 `getSince()`、`find()` |
| **失忆的肌肉** | `server/side-effects.js` | 订阅 EventLog，对过渡态事实做出反应 | 不允许持有业务状态、不做推导决策 |

### 事实分类

| 类别 | 示例 | 存储位置 |
|------|------|----------|
| **持久事实 (Fact)** | `squad:node_state`、`session:start` | EventLog（永存） |
| **过渡态事实 (Transitional Fact)** | `session:creating`、`session:prompting` | EventLog（阻断 Reactor 重复推导） |
| **流式事件** | `session:message_delta`、`session:thinking_delta` | 仅广播，不入 EventLog |

**系统中不存在"意图/指令（Command）"类别**。Reactor 推导的所有 Action 要么是持久事实，要么是过渡态事实。SideEffects 作为 EventLog 订阅者，被动响应过渡态事实，而非被 Reactor 调用。

## 参考项目

各项目详细文件级索引见 `PRD/REF-*.md`：

| 文档 | 路径 | 内容 |
|------|------|------|
| `REF-01-tau-mirror-core.md` | `../node_modules/tau-mirror/` | 原生 tau-mirror：`extensions/mirror-server.ts`(WS 服务端/用户消息路由)、`public/`(前端全量) |
| `REF-02-oh-tau-mirror.md` | `../oh-tau-mirror/` | 适配层：`proxy.js`(MITM/多会话路由/透明转发)、`index.js`(桥接)、`injected.js`(浏览器注入) |
| `REF-04-omp-extension-api.md` | `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/` + `../shim-packages/` | OMP 扩展 API：`ExtensionAPI`、`sendUserMessage`、`SessionManager`、`createAgentSession`、shim 格式 |
| `REF-05-plugin-structure.md` | `../block-head-tail/`、`../ollama-search/` | 标准插件结构（`index.js` + `test/`） |

## 参考网址

| 资源 | URL | 用途 |
|------|-----|------|
| Chakra UI (v3) | https://www.chakra-ui.com/docs/components | `Drawer`、`Collapsible`、`Dialog`、`Button`、`Badge`、`Table`、`Tooltip`、`Portal` 等组件文档 |
| lucide-react | https://lucide.dev/icons/ | 选择最贴合语义的图标 |
| React (v18) | https://react.dev/ | React 18 API |
| Mermaid (v11) | https://mermaid.js.org/ | DAG 图渲染 API |
| Vite (v8) | https://vite.dev/ | `createServer` Node API 文档 |
| Puppeteer | https://pptr.dev/ | 端到端测试 |

## 提示词模板

### 初始任务提示（/squad 发送给 LLM）

<prompt name="architect">
你现在是 Squad-Tau 架构师。用户交给了你一个总任务，你需要：
1. 分析任务，判断适合 M 模式（单节点）还是 L 模式（多节点 DAG）
2. 在系统临时目录（如 /tmp/squad-xxx）准备子任务描述文件
3. 每个节点一个 `.toml` 文件，文件名即节点 ID
4. 所有字段必填：
   - `task`：详细描述问题背景、最终目标、工作方法（例如 TDD）、参考材料、注意事项
   - `depends_on`：独立节点填 `[]`，依赖节点填其他文件名（不含 `.toml` 后缀）
   - `[[review_criteria]]`：每条含 `name` + `description`，description 要具体可检查

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

5. 完成后调用 `delegate({ plan_dir: "/tmp/squad-xxx" })` 提交

注意：`task` 描述必须尽可能详细，`review_criteria` 的 `description` 要具体可检查。
</prompt>

### Worker 提示（buildWorkerPrompt）

<prompt name="worker">
你现在是 Squad-Tau 工程师，负责实现分配给你的子任务。

你的任务: {node.task}
评审标准: {review_criteria 逐条 name: description}
上游任务结果: {上游逐条: - {id}: {summary}, 文件: {affected_files}}

工作记录 (1): {oldReport}
审阅者反馈 (1): {feedback}
工作记录 (2): {oldReport}
审阅者反馈 (2): {feedback}
...
工作记录 (n): {oldReport}
审阅者反馈 (n): {feedback}

现在是第 (n + 1) 轮，请你继续完善后提交。

---

完成任务后，必须调用 return 工具：
- status: "ok"
- reason: 第 (n + 1) 轮工作记录
- affected_files: 你创建或修改的每个文件

不要用文字表示完成。只有工具调用才算数。
</prompt>

### Self-Confirm 提示（buildConfirmPrompt）

<prompt name="self-confirm">
你现在被 Squad-Tau 要求验证自己的交付质量。请使用原始任务描述来评审工作，不要依赖你自己之前提交的摘要，避免幻觉和遗漏。

原始任务: {node.task}
评审标准: {review_criteria 逐条 name: description}

审查维度:
1. 代码质量 — 是否正确、清晰、符合惯例？
2. 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
3. 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
4. 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

- 请你在继续工作并彻底完成之后，调用 return({ status: "ok", reason, affected_files })
</prompt>

### Reviewer 提示（buildReviewerPrompt）

<prompt name="reviewer">
你现在是 Squad-Tau 审核专员，负责评审工程师的交付。

原始任务: {node.task}
评审标准: {review_criteria 逐条 name: description}

工作记录 (1): {oldReport}
审阅者反馈 (1): {feedback}
工作记录 (2): {oldReport}
审阅者反馈 (2): {feedback}
...
工作记录 (n): {oldReport}

本次提交的修改文件列表: {workerResult.affected_files}

请你撰写审阅者反馈 (n)。

审查维度:
1. 代码质量 — 是否正确、清晰、符合惯例？
2. 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
3. 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
4. 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

---
结束时调用：
- return({ status: "ok", reason: "..." }) — 通过
- return({ status: "error", reason: "..." }) — 驳回附详细修改意见
</prompt>

### 外层 Review 提示（buildOuterReviewPrompt）

<prompt name="outer-review">
你现在是 Squad-Tau 最终审核者，负责评审多节点协作的聚合结果。

原始任务:
{originalTask}

节点结果:
{节点逐条: - {id} ({status}): {summary}, 文件: {affectedFiles}}

---
聚合结果是否满足原始任务？
- 满足：return({ status: "ok", reason: "..." })
- 不满足：return({ status: "error", reason: "..." }) 附详细修改意见
</prompt>

## 工作铁律

### 修 Bug 原则
- **不准兜底**。出现兜底就是掩盖根因，必须追踪到消息 ID 为何缺失、状态为何丢失，在源头修复。
- **不准防御性编程**。`if (x) x.startsWith(...)` 这种代码说明上游契约被破坏，去上游修。

### 测试原则
- **底层代数断言**：给定静态 State 树，断言 Reactor 必然输出的 Action[]。0 毫秒执行，覆盖 100% 边界。
- **中层时空折叠**：用内存 while 循环 + 伪造 SideEffect，瞬间推演多步流转，验证 DAG 因果律不变量。
- **顶层真实混沌**：PTY 直连（`simulation.js`）不落盘、不轮询。管道挂载拦截内存流，验证 WebSocket 水位线同步在断网、乱序中绝不丢失状态。

### 代码审查原则
- **出现兜底两个字就是垃圾**。review 时看到 fallback / guard / 防御性检查，直接打回。
- **越大修越好**。不要怕改多文件，根因修复必然跨模块。
