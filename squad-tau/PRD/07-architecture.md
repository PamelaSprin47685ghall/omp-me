# Squad-Tau PRD — 07 技术架构

## 7.1 目录结构

```
squad-tau/
├── index.js                  # 插件入口
├── shim.mjs                  # Shim 导出
├── server/
│   ├── http-server.js        # HTTP + WebSocket 服务器
│   ├── event-bus.js          # 进程内事件总线
│   ├── squad-engine.js       # Squad 编排引擎（命令注册 + FSM）
│   ├── dag-executor.js       # DAG 执行器
│   ├── node-runner.js        # Worker/Reviewer/Confirm 会话执行
│   ├── session-router.js     # 用户消息路由：sessionId → session 映射
│   ├── model-pool.js         # 模型池管理
│   ├── state-machine.js      # 节点状态机（纯函数）
│   └── outer-review.js       # 外层 review
├── client/
│   ├── src/
│   │   ├── App.jsx            # React 根组件
│   │   ├── main.jsx           # 入口
│   │   ├── types.js           # 类型定义（纯 JSDoc 注释）
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── DAGView.jsx
│   │   │   ├── SessionTree.jsx
│   │   │   ├── MainContent.jsx
│   │   │   ├── MessageList.jsx
│   │   │   ├── MessageInput.jsx
│   │   │   ├── ThinkingBlock.jsx
│   │   │   ├── ToolCall.jsx
│   │   │   ├── ModelPoolDrawer.jsx
│   │   │   └── StatusBar.jsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.js
│   │   │   ├── useSquadState.js
│   │   │   ├── useSessionState.js
│   │   │   └── useModelPool.js
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── test/
│   ├── unit/
│   │   ├── state-machine.test.js
│   │   ├── dag-executor.test.js
│   │   ├── model-pool.test.js
│   │   ├── event-bus.test.js
│   │   └── node-runner.test.js
│   ├── integration/
│   │   ├── squad-flow.test.js
│   │   └── websocket.test.js
│   └── e2e/
│       ├── browser.test.js        # OMP 内部测试
│       ├── standalone.test.js     # 独立测试
│       └── helpers/
│           ├── puppeteer-setup.js  # 共享浏览器启动
│           ├── mock-pi.js          # 共享 pi mock
│           └── assertions.js       # 共享断言
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
  const server = await createServer({ root: clientRoot });
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

### 7.2.3 Squad 引擎 (`squad-engine.js`)
- 注册 `/squad`、`/squad-models` 命令
- 管理 `SquadFSM`（idle / active / revising）
- 在 active 时激活 `submit_plan` 工具

### 7.2.4 DAG 执行器 (`dag-executor.js`)
- `validateNodes(nodes)` — 验证节点定义
- `topologicalSort(nodes)` — 拓扑排序
- `executeLayer(nodes, ctx, pi, signal, viewManager)` — 执行一层
- `executeDAG(nodes, ctx, pi, signal, viewManager)` — 完整 DAG 执行

### 7.2.5 节点执行器 (`node-runner.js`)
- `runWorker(node, upstreamResults, reviewerFeedback, ctx, pi, signal, viewManager, modelSlot)`
- `runConfirmSession(pi, workerOptions, confirmPrompt, signal, toolBuilders)`
- `runReviewer(node, workerResult, ctx, pi, signal, viewManager, modelSlot)`
- `runNode(node, upstreamResults, ctx, pi, signal, viewManager, modelPool)` — 完整节点生命周期

### 7.2.6 模型池 (`model-pool.js`)
- `loadModelsConfig()` / `saveModelsConfig(config)` — 读写 JSON
- `ModelPool` 类 — acquire/release 队列
- `createModelPool(config)` — 工厂函数

### 7.2.7 状态机 (`state-machine.js`)
- 纯函数，无副作用
- `transition(state, event)` → newState
- `emptyState(nodeId, hasDeps)` → initialState
- 所有状态 × 事件矩阵

### 7.2.8 外层 Review (`outer-review.js`)
- `buildOuterReviewPrompt(nodes, results, originalTask, round)`
- `runOuterReview(nodes, results, originalTask, round, ctx, pi, signal, viewManager)`

## 7.3 构建与开发模式

- **纯 JavaScript**：前后端全部使用 JavaScript（JSX），不引入 TypeScript
- **Dev 模式优先**：前端目前只考虑开发模式，不打包
- `http-server.js` 调用 Vite Node API 内联创建 dev server：
  ```js
  const { createServer } = await import('vite');
  const viteServer = await createServer({
    root: join(__dirname, '..', 'client'),
    server: { middlewareMode: true },
  });
  app.use(viteServer.middlewares);
  ```
- Vite 自动处理：JSX 转换、Hot Module Replacement、静态资源
- 开发时修改前端源码即时生效，无需手动刷新

## 7.4 依赖关系

```
Dependencies (internal only):
  @oh-my-pi/resolve-pi  -- getCodingAgentModule for SessionManager
```

所有 tau-mirror 功能（WebSocket 服务、前端 UI、会话路由、实时流）全部内联实现。
