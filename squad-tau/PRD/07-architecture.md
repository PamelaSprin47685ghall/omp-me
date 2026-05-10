# Squad-Tau PRD — 07 技术架构

## 7.1 目录结构（因单文件 ≤200 行约束而强制拆分）

> **拆分原则**：每个文件职责单一，控制在 200 行以内。大型模块按功能拆分为多个文件（如 `node-runner` → 7 个文件，`dag-executor` → 4 个文件，`model-pool` → 3 个文件）。

```
squad-tau/
├── index.js                  # 插件入口：加载并启动所有模块
├── shim.mjs                  # Shim 导出
├── server/
│   ├── constants.js          # 事件类型、状态枚举、默认值
│   ├── state-machine.js      # 节点状态机（纯函数 transition/emptyState）
│   ├── event-bus.js          # EventEmitter 事件总线（命名空间+通配符）
│   ├── session-registry.js   # sessionId → {sendUserMessage} 映射
│   ├── squad-fsm.js          # Squad FSM（idle/active/revising）
│   ├── model-pool.js         # ModelPool 类（acquire/release/排队）
│   ├── model-pool-config.js  # models.json 读写 + fs.watchFile
│   ├── model-pool-events.js  # WebSocket model_pool 事件分派
│   ├── dag-validate.js       # validateNodes（ID 唯一性、依赖引用检查）
│   ├── dag-sort.js           # topologicalSort（Kahn 算法+环检测）
│   ├── dag-execute.js        # executeDAG（完整 DAG 编排）
│   ├── dag-concurrency.js    # executeLayer（分层并发控制）
│   ├── run-worker.js         # runWorker（创建 session、注入工具、prompt）
│   ├── run-worker-prompt.js  # buildWorkerPrompt（含上游结果/审阅反馈）
│   ├── run-confirm.js        # runConfirmSession（自审生命周期）
│   ├── run-confirm-prompt.js # buildConfirmPrompt（用原始任务构建）
│   ├── run-reviewer.js       # runReviewer（审阅会话生命周期）
│   ├── run-reviewer-prompt.js# buildReviewerPrompt（含 review_criteria）
│   ├── run-node.js           # runNode 完整节点生命周期编排
│   ├── tamper-detection.js   # captureFileSnapshots / filesChanged
│   ├── empty-turns.js        # MAX_EMPTY_TURNS / CONFIRM_MAX_EMPTY 常量
│   ├── outer-review.js       # runOuterReview / buildOuterReviewPrompt
│   ├── retry-logic.js        # 重试状态管理
│   ├── submit-plan.js        # submit_plan 工具处理器
│   ├── validate-plan.js      # validatePlan 校验
│   ├── squad-engine.js       # 命令注册、FSM 编排、/squad /squad-models
│   ├── http-server.js        # HTTP 服务器创建+端口分配
│   ├── ws-server.js          # WebSocket 服务器（绑定 HTTP）
│   ├── ws-handler.js         # WS 消息分派（按 type 路由到各模块）
│   ├── ws-heartbeat.js       # Ping/pong 心跳+断连清理
│   ├── ws-events.js          # 事件总线→WS 消息转发
│   └── vite-setup.js         # Vite createServer Node API 集成
├── client/
│   ├── index.html            # SPA 入口
│   ├── vite.config.js        # Vite 配置
│   ├── main.jsx              # React DOM 入口
│   ├── App.jsx               # 根组件
│   ├── App.css               # 自定义样式
│   ├── types.js              # JSDoc 类型定义
│   ├── hooks/
│   │   ├── useWebSocket.js       # WebSocket 连接+指数退避重连
│   │   ├── useWebSocket-events.js# 事件分流（从 WS 到 state hooks）
│   │   ├── useSquadState.js      # Squad 状态 reducer
│   │   ├── useSessionState.js    # 会话状态 reducer
│   │   ├── useModelPool.js       # 模型池状态
│   │   ├── useAutoScroll.js      # 自动滚动逻辑
│   │   └── useDarkMode.js        # 系统深色模式检测
│   └── components/
│       ├── Header.jsx
│       ├── Sidebar.jsx
│       ├── SessionTree.jsx
│       ├── MainContent.jsx
│       ├── DAGView.jsx
│       ├── MessageList.jsx
│       ├── MessageItem.jsx
│       ├── MessageInput.jsx
│       ├── ThinkingBlock.jsx
│       ├── ToolCall.jsx
│       ├── WelcomeView.jsx
│       ├── ErrorBanner.jsx
│       ├── ModelPoolDrawer.jsx
│       └── StatusBar.jsx
├── test/
│   ├── helpers/
│   │   ├── mock-pi.js            # Stub pi 工厂
│   │   ├── assertions.js         # 共享断言
│   │   ├── puppeteer-setup.js    # Puppeteer 启动/清理
│   │   └── rpc-tmux.js           # RPC tmux 客户端
│   ├── unit/
│   │   ├── state-machine.test.js
│   │   ├── event-bus.test.js
│   │   ├── model-pool.test.js
│   │   ├── dag-sort.test.js
│   │   ├── dag-validate.test.js
│   │   ├── dag-execute.test.js
│   │   ├── dag-concurrency.test.js
│   │   ├── tamper-detection.test.js
│   │   ├── empty-turns.test.js
│   │   ├── squad-fsm.test.js
│   │   ├── run-worker.test.js
│   │   ├── run-confirm.test.js
│   │   └── run-reviewer.test.js
│   ├── integration/
│   │   ├── squad-flow-setup.js   # 共享 squad 集成测试 setup
│   │   ├── squad-flow.test.js    # M 模式/L 模式完整流程
│   │   └── websocket.test.js     # WS 通信/多客户端
│   └── e2e/
│       ├── standalone.test.js    # 独立 Puppeteer 测试
│       ├── browser.test.js       # OMP 内嵌 Puppeteer
│       ├── rpc-e2e.test.js       # OMP RPC 模式驱动
│       └── chaos-e2e.test.js     # 混沌测试
├── package.json
├── README.md
└── SPEC.md
```

## 7.2 服务端组件

### 7.2.1 HTTP + WebSocket 服务器 (`http-server.js`)
- 默认端口：9527（冲突则递增，最多 10 次尝试）
- 绑定 `127.0.0.1`（仅本地可访问）
- 使用 Vite `createServer` Node API 创建开发服务器：
  ```js
  const { createServer } = await import('vite');
  const server = await createServer({ root: join(__dirname, 'client') });
  ```
- Vite 自动处理 JSX 转换、静态资源、热更新
- HTTP 路由（在 Vite 中间件之后）：
  - `GET /api/status` → 服务运行状态 JSON
- WebSocket：
  - `ws://127.0.0.1:<port>/ws` → 双向 JSON 消息
  - 订阅 `event-bus` 的所有 `ws:*` 事件并广播
  - 接收浏览器消息，按 `type` 分发到对应模块：
    - `model_pool:update` → 转发到 model-pool 模块
    - `session:user_message` → 转发到 session-router 模块，按 sessionId 找到对应 session 并调用 `pi.sendUserMessage()`
    - `abort` → 转发到 squad-engine
  - 维护 `sessionRegistry: Map<string, { sendUserMessage, session }>`，由 node-runner 在创建 session 时注册，结束时移除
  - 心跳：每 30s ping，60s 无 pong 则断开
  - 断开自动清理订阅

### 7.2.2 事件总线 (`event-bus.js`)
- 基于 `EventEmitter` 的命名空间事件总线
- 支持通配符订阅 `squad:*`
- 事件 → WebSocket 映射：
  - `squad:*` → 直接转发为 `squad:*` WS 消息
  - `session:*` → 直接转发为 `session:*` WS 消息
  - `model_pool:*` → 直接转发为 `model_pool:*` WS 消息
- WebSocket 服务器不再读 session 文件，只从事件总线获取数据

### 7.2.3 Squad 引擎 (`squad-engine.js`、`submit-plan.js`、`validate-plan.js`)
- `squad-engine.js`：注册 `/squad`、`/squad-models` 命令，管理 `SquadFSM`，在 active 时激活 `submit_plan` 工具
- `submit-plan.js`：`submit_plan` 工具处理器（校验、触发 executeDAG）
- `validate-plan.js`：`validatePlan` 校验函数

### 7.2.4 DAG 执行器 (`dag-validate.js`、`dag-sort.js`、`dag-execute.js`、`dag-concurrency.js`)
- `dag-validate.js`：`validateNodes(nodes)` — 验证节点定义
- `dag-sort.js`：`topologicalSort(nodes)` — 拓扑排序（Kahn 算法+环检测）
- `dag-execute.js`：`executeDAG(nodes, ctx, pi, signal, viewManager)` — 完整 DAG 编排
- `dag-concurrency.js`：`executeLayer(nodes...)` — 分层并发执行

### 7.2.5 节点执行器（7 个文件：`run-node.js` 编排 + `run-worker.js`/`run-confirm.js`/`run-reviewer.js` 执行 + `*-prompt.js` prompt 构建）
- `run-node.js`：`runNode(node, upstreamResults, ctx, pi, signal, viewManager, modelPool)` — 完整节点生命周期编排
- `run-worker.js`：`runWorker(node, upstreamResults, reviewerFeedback, ctx, pi, signal, viewManager, modelSlot)` — Worker 执行
- `run-worker-prompt.js`：`buildWorkerPrompt(node, upstreamResults, reviewerFeedback)` — 构建 Worker 提示词
- `run-confirm.js`：`runConfirmSession(pi, workerOptions, confirmPrompt, signal, toolBuilders)` — 自审
- `run-confirm-prompt.js`：`buildConfirmPrompt(workerResult)` — 构建自审提示词（用原始任务，不用 summary）
- `run-reviewer.js`：`runReviewer(node, workerResult, ctx, pi, signal, viewManager, modelSlot)` — 审阅
- `run-reviewer-prompt.js`：`buildReviewerPrompt(node, workerResult)` — 构建审阅提示词

### 7.2.6 模型池（`model-pool.js`、`model-pool-config.js`、`model-pool-events.js`）
- `model-pool.js`：`ModelPool` 类 — acquire/release 队列 + `createModelPool(config)` 工厂
- `model-pool-config.js`：`loadModelsConfig()` / `saveModelsConfig(config)` — 读写 JSON + `fs.watchFile` 监听
- `model-pool-events.js`：WebSocket `model_pool:*` 事件处理（add/remove/edit 转发）

### 7.2.7 常量与状态机（`constants.js`、`state-machine.js`）
- `constants.js`：事件类型常量（`SQUAD_INIT`/`NODE_STATE` 等）、状态枚举（`STATUS`/`EVENT`）、默认值（`DEFAULT_PORT`/`FALLBACK_CONCURRENCY`）
- `state-machine.js`：纯函数 `transition(state, event)` + `emptyState(nodeId, hasDeps)`，无副作用

### 7.2.8 外层 Review 与重试（`outer-review.js`、`retry-logic.js`）
- `outer-review.js`：`runOuterReview(nodes, results, originalTask, round, ctx, pi, signal, viewManager)` + `buildOuterReviewPrompt(...)`
- `retry-logic.js`：重试状态管理、retryCount 增量、Revise 循环

### 7.2.9 其他服务端文件
- `session-registry.js`：`Map<sessionId, { sendUserMessage, session }>` 注册表，由 node-runner 注册/注销
- `empty-turns.js`：`MAX_EMPTY_TURNS`(20) / `CONFIRM_MAX_EMPTY`(5) 常量和空轮次检测
- `tamper-detection.js`：`captureFileSnapshots()` / `filesChanged()` — mtime 快照对比
- `squad-fsm.js`：Squad FSM (idle/active/revising)
- `http-server.js`：Express-like HTTP 服务器 + Vite middleware 集成
- `ws-server.js`：`ws.Server` 实例管理
- `ws-handler.js`：消息路由（`model_pool:update`→model-pool, `session:user_message`→session-router, `abort`→squad-engine）
- `ws-heartbeat.js`：30s ping / 60s 超时断连
- `ws-events.js`：event-bus `*` 事件 → WebSocket 广播
- `vite-setup.js`：Vite `createServer` Node API 包装

## 7.3 构建与开发模式

- **纯 JavaScript**：前后端全部使用 JavaScript（JSX），不引入 TypeScript
- **Dev 模式优先**：前端目前只考虑开发模式，不打包
`vite-setup.js` 调用 Vite Node API 内联创建 dev server，`http-server.js` 应用 middleware。

### 7.3.1 命名约定
- 所有服务端文件使用 kebab-case（`state-machine.js`）
- 所有客户端文件使用 PascalCase 组件名（`Header.jsx`）或 camelCase hooks（`useWebSocket.js`）
- 测试文件后缀 `.test.js`，与被测试文件同名
  ```js
  const { createServer } = await import('vite');
  const viteServer = await createServer({
    root: join(__dirname, 'client'),
    server: { middlewareMode: true },
  });
  app.use(viteServer.middlewares);
  ```
- Vite 自动处理：JSX 转换、Hot Module Replacement、静态资源
- 开发时修改前端源码即时生效，无需手动刷新

## 7.4 依赖关系

```
Runtime deps:
  @oh-my-pi/resolve-pi  -- getCodingAgentModule for SessionManager
  ws                     -- WebSocket server (bundled dependency)
  vite                   -- Dev server (bundled dependency)
  @blueprintjs/core      -- UI components
  @blueprintjs/icons     -- Icons
  react / react-dom      -- UI framework
  mermaid                -- DAG visualization

Dev deps:
  puppeteer              -- E2E tests
  bun:test               -- Bun test runner (built-in)
```

所有 tau-mirror 功能（WebSocket 服务、前端 UI、会话路由、实时流）全部内联实现。

## 7.5 文件规模统计

| 区域 | 文件数 | 最大行数 | 说明 |
|------|--------|----------|------|
| server/ | 28 个 JS | ≤200 | 按功能拆分为独立职责模块 |
| client/ | 21 个 JSX/JS/CSS | ≤200 | 组件、hooks、入口 |
| test/ | 18 个 JS | ≤200 | unit/integration/e2e + helpers |
| 根目录 | 4 个 | ≤200 | index.js, shim.mjs, package.json, README, SPEC |
| **总计** | **~71 个文件** | **≤200** | |
