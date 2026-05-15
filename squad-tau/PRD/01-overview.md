# Squad-Tau PRD — 01 北极星

**Version**: 2.0.0
**Date**: 2026-05-15
**Status**: 修宪版 — 纯事件溯源 + 无 CMD 架构

## 宇宙公理

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
    SE -.->|4. Silently reads Facts| EL
    SE -->|5. Call APIs| OMP[LLM / FS]
    OMP -->|6. Async Callbacks| EL
```

**关键区别（与旧架构）：**
- Reactor **不输出 CMD**。它只向 EventLog 追加持久事实（`squad:node_state`）和过渡态事实（`session:creating`、`session:prompting`）。
- SideEffects **不受 Reactor 直接调用**。它是 EventLog 的一个无声订阅者——听到特定的过渡态事实（如 `session:creating`），就默默去调 API。结果以新事实形式追加回 EventLog。
- 整个回路中没有"指令"或"意图"的概念。只有事实。

**这是系统的宇宙公理**。所有组件都是围绕 EventLog（不可变事实日志）的纯函数推导循环。系统没有任何"流程控制"——只有数据、规则、和副作用。

## 1.1 项目定位

Squad-Tau 是一个将 Squad（DAG 多代理编排）和 Tau-Mirror（Web UI 实时镜像）深度集成的 oh-my-pi 插件。它完全重新实现 tau-mirror 的所有功能，不再引用外部 tau-mirror 包，并采用事件溯源（Event Sourcing）架构——不通过任何中介层或同步机制协调状态。

## 1.2 核心能力

- **DAG 任务编排**：M 模式（单节点）和 L 模式（多节点并行 + 外层 review）
- **Worker-Reviewer 强制循环**：每个节点经过 authoring → self-confirm → review → approved/rejected
- **实时 Web UI**：React + Chakra UI 构建的现代化界面，实时显示所有会话、DAG 状态、thinking 流
- **纯事件驱动架构**：无 Proxy、无 EventBus、无 FSM、无 CMD。EventLog 是唯一事实源，Reactor 是唯一推导引擎，Projections 是唯一物化视图
- **代数并发控制**：Reactor 计算 `countLiveSessions(state) < maxWorkers`，纯不等式，无队列，无 acquire/release
- **确定性 URN 寻址**：所有实体 ID 为 `NodeId::Phase::RetryCount` 的确定字符串，不生成任何随机/UUID
- **用户消息 steer**：用户可从 Web UI 向任意活跃 session 发送消息（主会话或 squad 子会话），通过自然语言实时指导 agent 工作方向

## 1.3 架构核心概念

| 概念 | 定义 | 文件 |
|------|------|------|
| **EventLog（真理源）** | 全局唯一的追加式不可变事实日志。所有状态变更的唯一入口 | `server/event-log.js` |
| **Projections（物化视图）** | 纯函数增量折叠器。`f(prevState, Event) → nextState`。无日志引用、无副作用 | `shared/projections.js` |
| **Reactor（推导大脑）** | 纯函数规则引擎。`f(State) → TransitionalFact[]`。无历史扫描、无模型池交互 | `server/reactor.js` |
| **Side Effects（失忆的肌肉）** | EventLog 订阅者。听到 `session:creating`/`session:prompting` 等过渡态事实后，执行 I/O 操作，结果追加到 EventLog | `server/side-effects.js` |
| **Engine Pulse（引擎脉冲）** | 微任务批处理。监听 EventLog，dirty 标志触发一次 react() → 追加事实 → 再触发，直到收敛 | `server/engine.js` |

## 1.4 架构变化（与旧时代不兼容）

| 项目 | 旧世界 (squad + tau-mirror) | 新宇宙 (squad-tau) |
|------|---------------------------|-------------------|
| 代理层 | MITM proxy 拦截 HTTP/WS | 无 proxy，直接 HTTP + WS 服务器 |
| 状态管理 | EventBus + FSM + 状态机对象 | EventLog + Reactor 纯函数推导 + Projections 增量折叠 |
| 推导输出 | Reactor → CMD → SideEffects 被调用 | Reactor → Transitional Fact → EventLog → SideEffects 悄声订阅 |
| 模型池 | `ModelPool` 类 + async acquire/release + 等待队列 | 纯代数不等式 `countLive < maxWorkers`，无类、无队列 |
| 实体寻址 | UUID / 随机 ID | 确定性 URN `NodeId::Phase::RetryCount` |
| 前端状态 | Reducer 含计算逻辑 + `useState` | 绝对贫血：`ui:xxx` 事件 → EventStore 折叠 → `useSyncExternalStore` O(1) 绑定 |
| 测试策略 | Puppeteer DOM 轮询 + Mock 等待时序 | 代数断言 + 时空折叠器 + 幽灵 PTY 仿真 |
| 传输 | 全量消息同步 | delta 渲染，只传增量 |
| HTTP 端口 | 固定端口 9527 | OS 随机分配（`server.listen(0)`），无需端口冲突处理 |
| 语言 | TypeScript 前端 + JS 服务端 | 纯 JavaScript（前后端都 JS） |
| DAG 渲染 | mermaid | `beautiful-mermaid`（内置暗色主题支持） |
| 并发控制 | 分层队列 + Promise.race 信号量 | 声明式不等式：`countLiveSessions < maxWorkers` |

## 1.5 真空宣言

系统已彻底消灭了以下旧世界实体（不是"不推荐使用"，而是**根本不存在**）：

| 已抹杀实体 | 替代方案 |
|-----------|----------|
| HTTP 路由中间件（Express/Koa） | 自制 `createApp()` 中间件栈，纯函数式组合 |
| EventBus | EventLog 追加 + 订阅 |
| 模型槽位池 (Slots) | 静态 `maxWorkers` 整数 |
| 拓扑排序器 (Kahn) | Reactor 声明式依赖条件 `node.depends_on.every(...)` |
| CMD/Command/意图 | 过渡态事实直接写入 EventLog |
| UUID / 随机 ID | 确定性 URN（`n1::authoring::0`） |
| acquire/release 方法 | `countLiveSessions(state) < maxWorkers` 不等式 |
| `useState` 业务状态 | `ui:xxx` 事件 → EventStore 投影 |
