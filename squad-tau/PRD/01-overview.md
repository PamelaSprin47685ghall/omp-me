# Squad-Tau PRD — 01 概述

**Version**: 2.0.0
**Date**: 2026-05-14
**Status**: 修宪版 — 基于纯事件溯源 + 无状态推导架构

## 北极星架构图

```mermaid
graph TD
    subgraph Truth
        EL[(Event Log\nAppend-Only Facts)]
    end

    subgraph Nervous System
        PROJ((Projections\nIncremental Fold))
    end

    subgraph Brain
        REACT{Reactor\nPure f(State)}
    end

    subgraph Muscle
        SE[Side Effects\nFire & Forget]
    end
    
    subgraph UI
        DOM[React View\nf(State)]
    end

    EL -- 1. Trigger Pulse --> PROJ
    PROJ -- 2. Emit State --> REACT
    PROJ -- Sync --> DOM
    REACT -- 3. Yield CMDs --> SE
    REACT -- 3. Yield Facts --> EL
    SE -- 4. Call APIs --> OMP[LLM / FS]
    OMP -- 5. Async Callbacks --> EL
```

**这是系统的永动机回路**。所有组件都是围绕 EventLog（不可变事实日志）的纯函数推导循环。系统没有任何"流程控制"——只有数据、规则、和副作用。

## 1.1 项目定位

Squad-Tau 是一个将 Squad（DAG 多代理编排）和 Tau-Mirror（Web UI 实时镜像）深度集成的 oh-my-pi 插件。它完全重新实现 tau-mirror 的所有功能，不再引用外部 tau-mirror 包，并采用事件溯源（Event Sourcing）架构——不通过任何中介层或同步机制协调状态。

## 1.2 核心能力

- **DAG 任务编排**：M 模式（单节点）和 L 模式（多节点并行 + 外层 review）
- **Worker-Reviewer 强制循环**：每个节点经过 authoring → self-confirm → review → approved/rejected
- **实时 Web UI**：React + Chakra UI 构建的现代化界面，实时显示所有会话、DAG 状态、thinking 流
- **纯事件驱动架构**：无 Proxy、无 EventBus、无 FSM。EventLog 是唯一事实源，Reactor 是唯一推导引擎，Projections 是唯一物化视图
- **浏览器端模型池管理**：实时调整 worker/reviewer 槽位（纯数学计数器，无队列、无挂起）
- **用户消息 steer**：用户可从 Web UI 向任意活跃 session 发送消息（主会话或 squad 子会话），通过自然语言实时指导 agent 工作方向

## 1.3 架构核心概念

| 概念 | 定义 | 文件 |
|------|------|------|
| **EventLog（真理源）** | 全局唯一的追加式不可变事实日志。所有状态变更的唯一入口 | `server/event-log.js` |
| **Projections（物化视图）** | 纯函数增量折叠器。`f(prevState, Event) → nextState`。无日志引用、无副作用 | `shared/projections.js` |
| **Reactor（推导大脑）** | 纯函数规则引擎。`f(State) → Action[]`。无历史扫描、无 isFulfilled、无 nodeHistory | `server/reactor.js` |
| **Side Effects（失忆的肌肉）** | Fire-and-Forget 命令处理器。执行 CMD，结果追加到 EventLog | `server/side-effects.js` |
| **Engine Pulse（引擎脉冲）** | 微任务批处理。监听 EventLog，dirty 标志触发一次 react() → Action[] → 执行 → 追加事实 → 再触发，直到收敛 | `server/engine.js` |

## 1.4 架构变化（与之前不兼容）

| 项目 | 旧架构 (squad + tau-mirror) | 新架构 (squad-tau) |
|------|---------------------------|-------------------|
| 代理层 | MITM proxy 拦截 HTTP/WS | 无 proxy，直接 HTTP + WS 服务器 |
| 状态管理 | EventBus + FSM + 状态机对象 | EventLog + Reactor 纯函数推导 + Projections 增量折叠 |
| 模型池 | `ModelPool` 类 + async acquire/release + 等待队列 | 数学计数器（EventLog 投影） + 纯事实驱动 |
| 并发控制 | 分层队列 + Promise.race 信号量 | 声明式槽位差值：`Available = Total - usage.length` |
| 前端状态 | Reducer 含计算逻辑 | 绝对贫血：WebSocket 事件 → applyEvent() → React O(1) 绑定 |
| 测试策略 | Puppeteer DOM 轮询 + Mock 等待时序 | 代数断言 + 时空折叠器 + 顶层真实混沌 |
| 传输 | 全量消息同步 | delta 渲染，只传增量 |
| 前端 | tau-mirror 自带 UI | React + Chakra UI 全新实现 |
| 语言 | TypeScript 前端 + JS 服务端 | 纯 JavaScript（前后端都 JS） |
| HTTP 端口 | 固定端口 9527 | OS 随机分配（`server.listen(0)`），无需端口冲突处理 |
| DAG 渲染 | mermaid | `beautiful-mermaid`（内置暗色主题支持，无需额外 CSS） |
| 模块解析 | 直接 import | 通过 `@oh-my-pi/resolve-pi` 的 `importNodeModule` 动态解析 |
