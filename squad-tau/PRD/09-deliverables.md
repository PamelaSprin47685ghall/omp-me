# Squad-Tau PRD — 09 交付物与里程碑

## 9.1 交付物清单

- [x] PRD 文档集（本文件集 — 修宪版）
- [x] `squad-tau/` 完整源码（server + client + shared + test）
  - [x] 服务端：EventLog、Engine、Reactor（纯事实推导，无 CMD）、SideEffects（EventLog 订阅者）、网络层、静态模型池配置
  - [x] 前端：React SPA（绝对贫血，无 useState 业务状态）、Chakra UI 组件、event-store（`useSyncExternalStore` 原子订阅）、stream-router（Edge Gatekeeper 零缓冲区流式管线）、`<stream-sink>` Custom Element、`useStreams` hook
  - [x] 共享：前后端同构 projections.js + events.js（决定性 URN 寻址）
  - [x] 配置：`package.json`, `README.md`, `SPEC.md`
- [x] 代数断言单元测试（`test/unit/`）
  - [x] `reactor-orthogonal` — 正交规则测试
  - [x] `reactor-dag-invariants` — DAG 因果律不变量
  - [x] `reactor-failure-paths` — 失败路径边界
  - [x] `reactor-squad-complete` — 完成路径
  - [x] `reactor-outer-review` — 外层 review 规则
  - [x] `reactor-chain-trace` — 链式追踪
  - [x] `lifecycle-tools` — 工具注册
  - [x] `ws-handler` — 消息路由
- [x] 时空折叠器集成测试（`test/integration/`）
  - [x] `time-traveler.test.js` — M/L 模式全流程推演
  - [x] `fuzzing.test.js` — 模糊推演
- [x] 幽灵 PTY 物理仿真（`simulation.js` + `test/integration/`）
  - [x] `simulation.js` — 无磁盘、无轮询的 PTY 直连全链路测试
  - [x] `test/integration/chaos-ui-e2e.test.js` — 浏览器端混沌测试
  - [x] `test/integration/rpc-e2e.test.js` — OMP RPC 模式
  - [x] `test/integration/ui-full-flow.test.js` — UI 全流程
- [x] 测试辅助工具（`test/helpers/`）
  - [x] `state-builder.js` — 代数断言 State 构造器 Fluent DSL
  - [x] `engine-simulator.js` — 时空折叠引擎模拟器

## 9.2 非功能需求

### 性能
- WebSocket 消息频率 > 100/s，无丢失
- 10 节点并发执行，浏览器不卡顿
- Reactor 推导 < 1ms（纯函数 O(n)），100 节点在微秒级
- 流式渲染：Edge Gatekeeper 物理分流 + StreamRouter 零 JS 缓冲区 + `<stream-sink>` Custom Element + CSS `overflow-anchor: auto`

### 可靠性
- WebSocket 断开自动重连（指数退避：[1000, 2000, 4000, 8000, 16000, 30000]，`MAX_RECONNECT_ATTEMPTS=50`）
- 服务端异常 → 浏览器显示错误提示，自动重连
- EventLog 追加始终幂等——断线重连后全量回放无副作用
- **无 UUID**：所有实体 ID 决定论可重放，不存在随机状态

### 可用性
- 首次页面加载 < 2s（Vite 构建产物）
- 状态变更 UI 延迟 < 100ms（WebSocket → applyEvent → React 绑定）
- 模型池配置（`maxWorkers`）变更立即生效

### 可维护性
- JSDoc 类型注释覆盖关键 API
- 代数断言测试覆盖 Reactor 全部规则分支
- 无外部运行时依赖（仅 `@oh-my-pi/resolve-pi`）
- 零旧架构词汇：无 FSM、EventBus、CMD、拓扑排序、等待队列、UUID、acquire/release

## 9.3 里程碑

### Phase 1: 核心引擎（已完结）
- [x] 全部 server/：EventLog、Engine、Reactor（纯事实推导）、SideEffects（EventLog 订阅者）、网络层、模型池配置

### Phase 2: Web UI（已完结）
- [x] 全部 client/：React 组件、hooks（零 useState 业务状态）、event-store、样式

### Phase 3: 测试（已完结）
- [x] 代数断言 50+ 场景
- [x] 时空折叠器全覆盖
- [x] 幽灵 PTY 物理仿真（simulation.js）

### Phase 4: 文档与修宪（已完结）
- [x] README.md + SPEC.md
- [x] PRD 全集重构（新纪元修宪版）
- [x] AGENTS.md 宪法更新（扩充禁用词汇 + O(1) 数据铁律）
- [x] Edge Gatekeeper 物理分流：StreamRouter 零 JS 缓冲区 + `<stream-sink>` Custom Element + CSS `overflow-anchor: auto`
- [x] 确定性 URN：消灭随机 ID
- [x] 代数并发：`countLive < maxWorkers` 消灭 acquire/release
- [x] 零 CMD：Reactor 只产生事实，SideEffects 订阅 EventLog

## 9.4 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebSocket 消息丢失 | 低 | 单 WS 连接天然有序；丢失场景极少；UI 最终一致性可接受 |
| Reactor 无限推导（死循环） | 低 | Engine Pulse 无新 Action 时自然收敛；过渡态事实（`session:creating`、`session:prompting`）天然阻断重入 |
| 外层 review 无限循环 | 低 | 用户可随时 abort (Esc/Ctrl+C) |
| 浏览器性能瓶颈（大量消息） | 中 | Edge Gatekeeper 物理分流 + StreamRouter 零 JS 缓冲区 + Custom Element 原生 DOM 直写 + CSS overflow-anchor: auto |
| 配置并发冲突 | 低 | 服务端单线程 EventLoop + EventLog 序列化所有操作 |

## 9.5 已决策事项

| # | 讨论点 | 决策 |
|---|--------|------|
| 1 | 会话 ID | 确定性 URN `${nodeId}::${phase}::${retryCount}`，无随机数 |
| 2 | 事件序列保证 | 依赖单条 WebSocket 连接天然有序，无序列号/ack/重传 |
| 3 | tool_result 大小 | 不处理，模型上下文窗口自然限制 |
| 4 | 模型池空 | `maxWorkers` 默认为 3，可动态调整 |
| 5 | 并发控制 | 纯代数不等式 `countLiveSessions(state) < maxWorkers`，无队列、无 acquire/release |
| 6 | 重试回退 | 无退避，立即重试 |
| 7 | 测试架构 | 三神级防线：代数断言 + 时空折叠器 + 幽灵 PTY 仿真 |
| 8 | 实体寻址 | 确定性 URN，无 UUID、无随机 ID |
| 9 | SideEffects 激活 | 通过 EventLog 订阅过渡态事实，非 Reactor 直接调用 |
| 10 | React 版本 | 18.3.x |
| 11 | 语言 | 全部 JavaScript（JSX），无 TypeScript |
| 12 | 端口分配 | OS 随机分配（`server.listen(0)`） |
| 13 | UI: 前端状态模式 | 绝对贫血：所有交互触发 `ui:xxx` 事件 → EventStore 折叠 |
| 14 | UI: 流式渲染 | Edge Gatekeeper 物理分流：StreamRouter 零 JS 缓冲区 + `<stream-sink>` Custom Element + CSS `overflow-anchor: auto` |
| 15 | UI: 深色模式 | 自动跟随系统主题，Chakra colorMode |
| 16 | UI: 模型池配置 | 仅 `maxWorkers` 滑块，无槽位管理 |
| 17 | Vite 版本 | 8.0.x |
| 18 | Chakra UI 版本 | 3.x |
| 19 | DAG 渲染 | `beautiful-mermaid`（内置暗色主题支持，无需额外 CSS） |

## 9.6 设计变更记录

| # | 变更 | 旧设计 | 新设计 |
|---|------|--------|--------|
| 1 | 架构模式 | EventBus + FSM + Orchestrator | EventLog + Reactor pure f(State) + Projections |
| 2 | 推导输出 | Reactor → CMD → SideEffects 被调用 | Reactor → Transitional Fact → EventLog → SideEffects 订阅 |
| 3 | 并发控制 | Kahn 拓扑排序 + 分层队列 + Promise.race 信号量 | 代数不等式 `countLiveSessions < maxWorkers` |
| 4 | 模型池 | `ModelPool` 类 + async acquire/release + 等待队列 + 槽位数组 | 纯整数 `maxWorkers` 静态配置 |
| 5 | 前端状态 | Reducer 含计算逻辑 + `useState`/`useContext` | 绝对贫血：`ui:xxx` 事件 → EventStore → `useSyncExternalStore` O(1) 绑定 |
| 6 | 实体寻址 | UUID / 随机 ID | 确定性 URN `${nodeId}::${phase}::${retryCount}` |
| 7 | Reactor 输入 | 扫描 EventLog 历史（getSince + find） | 仅输入折叠后的扁平 State 对象 |
| 8 | 测试策略 | Puppeteer DOM 轮询 + setInterval 文件轮询 + Mock 等待时序 | 代数断言 + 时空折叠器 + 幽灵 PTY 仿真（simulation.js） |
| 9 | WebSocket 路由 | 通过 EventBus 桥接 | EventLog subscribe 直连广播 |
| 10 | 流式渲染 | React State 频繁 setState；delta 经 applyEvent 穿透整棵 React 树 | WebSocket 边缘物理分流（Edge Gatekeeper）：`useWebSocket.js` 中 `ws.onmessage` 按事件类型分裂，delta 直送 `streamRouter.dispatch()`，永不进入 `eventStore.dispatch()`。首次 delta 发射 `session:message_start` 创建骨架。StreamRouter 零 JS 缓冲区，直接 `TextNode.appendData()` 经 RAF 批处理。`<stream-sink>` Custom Element 原生生命周期替代 Hollow DOM ref 模式。 |
| 11 | 滚动侦测 | React `useEffect` + 同步 `scrollTop` 读取 + ResizeObserver | CSS `overflow-anchor: auto` 浏览器合成器原生锚定；零主线程占用、零 Layout Thrashing。浮动按钮 scrollTo 仅用户主动触发时使用。 |
| 12 | 外层 review 重置 | 手动节点重置逻辑 | Reactor 自动推导 |
