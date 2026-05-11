# Squad-Tau PRD — 07 技术架构

## 7.1 结构与拆分原则

### 顶层布局
```
squad-tau/
├── index.js          # 插件入口
├── shim.mjs          # ESM shim
├── server/           # 服务端（Node.js）
├── client/           # 前端（React SPA）
├── test/             # 测试
├── package.json
├── README.md
└── SPEC.md
```

### 拆分原则
- 单函数 ≤40 行，超限必须拆解
- 单文件 ≤200 行，超限必须拆解
- 按功能模块拆分：一个逻辑单元（如 DAG 执行器、模型池）拆为多个文件
- 文件名 kebab-case（服务端），PascalCase（组件），camelCase（hooks）
- 测试文件与被测文件同名，`.test.js` 后缀

### 模块分组（不约束文件名，只约束职责）

| 组 | 职责 | 文件模式 |
|----|------|--------|
| 引擎 | 命令注册、FSM 编排、工具注册 | `squad-engine`, `submit-plan`, `validate-plan` |
| DAG | 验证、拓扑排序、分层并发执行 | `dag-*` |
| 节点执行 | Worker/Reviewer 生命周期 + prompt 构建 | `run-*`, `*-prompt` |
| 模型池 | 配置文件读写 + acquire/release + WS 事件 | `model-pool*` |
| 网络 | HTTP 服务器、WebSocket、心跳、事件桥接 | `http-*`, `ws-*`, `vite-*` |
| 基础设施 | 常量、状态机、事件总线、session 注册表 | `constants`, `state-machine`, `event-bus`, `session-*` |
| 前端组件 | React 组件、hooks、reducer、样式 | `*.jsx`, `use*.js` |
| 测试 | 单元/集成/e2e + helpers | `*.test.js`, `*.skip.js` |

## 7.2 服务端组件

### 7.2.1 HTTP + WebSocket
- **插件加载时即启动**，不依赖 `/squad` 命令
- 默认端口 9527（冲突 +1 递增），绑定 `127.0.0.1`
- Vite `createServer` Node API 处理 JSX/HMR/静态资源
- WS `ws://127.0.0.1:<port>/ws`：双向 JSON，心跳 30s ping / 60s 超时
- `session:user_message` → `session.prompt(text)` 路由

### 7.2.2 事件总线
- `EventEmitter` + 命名空间通配符 `squad:*` / `session:*` / `model_pool:*`
- 所有 `*` 事件自动桥接到 WebSocket

### 7.2.3 Squad 引擎
- 注册 `/squad`、`/squad-models` 命令，管理 SquadFSM（idle/active 两态）
- `delegate` 工具定义（全局注册），LLM 在 idle 启动，rejected 后进入 active
- 执行期间 LLM 等待工具返回，不拥有控制权

### 7.2.4 DAG 执行器
- 拓扑排序（Kahn 算法 + 环检测）
- 分层并发控制，默认并发 5

### 7.2.5 节点执行器
- `runNode`：完整节点生命周期编排（acquire worker → 执行 → confirm → acquire reviewer → review）
- `runWorker`：Worker 执行 + Self-Confirm 一体化（同一 session，两次 `return`）
- `runReviewer`：审阅（每次新 session）
- prompt 构建：Worker prompt / Confirm prompt / Reviewer prompt
- v1.1.0：self-confirm 合并入 run-worker，不再有独立 confirm 模块

### 7.2.6 模型池
- acquire/release 队列 + 动态增删槽位
- `.omp/models.toml` 读写 + `fs.watchFile` 监听
- WS `model_pool:*` 事件分派

### 7.2.7 其他
- 常量/状态枚举、纯函数状态机、Squad FSM（idle/active）
- session 注册表（sessionId → session 映射，供 steer 路由）
- `return` 工具定义（全局注册）
- `MAX_EMPTY_TURNS = 20`
- outer review + retry 管理
- session 选项工厂 + 事件订阅转发
- WebSocket 服务器/消息路由/心跳/事件桥接
- Vite dev server 中间件

## 7.3 构建与开发模式

- **纯 JavaScript**：前后端全部使用 JavaScript（JSX），不引入 TypeScript
- **Dev 模式优先**：前端目前只考虑开发模式，不打包
`vite-setup.js` 调用 Vite Node API 内联创建 dev server，`http-server.js` 应用 middleware。

### 7.3.1 命名约定
- 所有服务端文件使用 kebab-case（`state-machine.js`）
- 所有客户端文件使用 PascalCase 组件名（`Header.jsx`）或 camelCase hooks（`useWebSocket.js`）
- 单元测试文件后缀 `.test.js`，与被测试文件同名
- 集成测试和端到端测试后缀 `.skip.js`（不参与 `bun test` 默认发现）
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
| server/ | ~36 个 JS | ≤200 | 引擎、DAG、节点执行、网络层 |
| client/ | 21 个 JSX/JS/CSS | ≤200 | 组件、hooks、入口 |
| test/ | 24 个 JS | ≤200 | unit/integration/e2e + helpers |
| 根目录 | 4 个 | ≤200 | index.js, shim.mjs, package.json |
| **总计** | **~82 个文件** | **≤200** | |
