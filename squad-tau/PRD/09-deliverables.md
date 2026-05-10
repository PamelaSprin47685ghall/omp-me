# Squad-Tau PRD — 09 交付物与里程碑

## 9.1 交付物清单

- [x] PRD 文档（本文件集）
- [ ] `squad-tau/` 完整源码（所有文件 ≤200 行，强制拆分）
  - [ ] 插件入口 `index.js` + `shim.mjs`
  - [ ] 服务端基础：`server/constants.js`, `server/state-machine.js`, `server/event-bus.js`, `server/session-registry.js`, `server/squad-fsm.js`, `server/empty-turns.js`, `server/tamper-detection.js`
  - [ ] 模型池：`server/model-pool.js`, `server/model-pool-config.js`, `server/model-pool-events.js`
  - [ ] DAG 引擎：`server/dag-validate.js`, `server/dag-sort.js`, `server/dag-execute.js`, `server/dag-concurrency.js`
  - [ ] 节点执行器：`server/run-node.js`, `server/run-worker.js`, `server/run-worker-prompt.js`, `server/run-confirm.js`, `server/run-confirm-prompt.js`, `server/run-reviewer.js`, `server/run-reviewer-prompt.js`
  - [ ] 外层控制：`server/outer-review.js`, `server/retry-logic.js`, `server/submit-plan.js`, `server/validate-plan.js`
  - [ ] 引擎：`server/squad-engine.js`
  - [ ] 网络层：`server/http-server.js`, `server/ws-server.js`, `server/ws-handler.js`, `server/ws-heartbeat.js`, `server/ws-events.js`, `server/vite-setup.js`
  - [ ] 前端入口：`client/index.html`, `client/vite.config.js`, `client/main.jsx`, `client/App.jsx`, `client/App.css`, `client/types.js`
  - [ ] 前端 hooks：`client/hooks/useWebSocket.js`, `client/hooks/useWebSocket-events.js`, `client/hooks/useSquadState.js`, `client/hooks/useSessionState.js`, `client/hooks/useModelPool.js`, `client/hooks/useAutoScroll.js`, `client/hooks/useDarkMode.js`
  - [ ] 前端组件：`client/components/Header.jsx`, `client/components/Sidebar.jsx`, `client/components/SessionTree.jsx`, `client/components/MainContent.jsx`, `client/components/DAGView.jsx`, `client/components/MessageList.jsx`, `client/components/MessageItem.jsx`, `client/components/MessageInput.jsx`, `client/components/ThinkingBlock.jsx`, `client/components/ToolCall.jsx`, `client/components/WelcomeView.jsx`, `client/components/ErrorBanner.jsx`, `client/components/ModelPoolDrawer.jsx`, `client/components/StatusBar.jsx`
  - [ ] 配置：`package.json` + `README.md` + `SPEC.md`
- [ ] 单元测试（> 80% 覆盖，每文件 ≤200 行）
  - [ ] `state-machine.test.js`
  - [ ] `event-bus.test.js`
  - [ ] `model-pool.test.js`
  - [ ] `dag-sort.test.js`
  - [ ] `dag-validate.test.js`
  - [ ] `dag-execute.test.js`
  - [ ] `dag-concurrency.test.js`
  - [ ] `tamper-detection.test.js`
  - [ ] `empty-turns.test.js`
  - [ ] `squad-fsm.test.js`
  - [ ] `run-worker.test.js`
  - [ ] `run-confirm.test.js`
  - [ ] `run-reviewer.test.js`
- [ ] 集成测试（核心流程覆盖）
  - [ ] `squad-flow.test.js`（M 模式、L 模式、外层 review）
  - [ ] `websocket.test.js`（通信、多客户端）
- [ ] 端到端测试
  - [ ] `browser.test.js`（OMP 内部 Puppeteer）
  - [ ] `standalone.test.js`（独立 Puppeteer 执行）
  - [ ] `rpc-e2e.test.js`（OMP RPC 模式，最终集成测试）
  - [ ] `chaos-e2e.test.js`（混沌测试）
  - [ ] `helpers/puppeteer-setup.js`
  - [ ] `helpers/mock-pi.js`
  - [ ] `helpers/rpc-tmux.js`
  - [ ] `helpers/assertions.js`

## 9.2 非功能需求

### 性能
- WebSocket 消息频率 > 100/s，无丢失
- 10 节点并发执行，浏览器不卡顿
- 100 条消息的会话，虚拟滚动流畅

### 可靠性
- WebSocket 断开自动重连（指数退避：1s, 2s, 4s, 8s, ...max 30s）
- 服务端异常 → 浏览器显示错误提示，自动重连
- 文件篡改检测 100% 准确（mtime）

### 可用性
- 首次页面加载 < 2s（Vite 构建产物）
- 状态变更 UI 延迟 < 100ms（WebSocket → React state → DOM）
- 模型池配置变更立即生效

### 可维护性
- JSDoc 类型注释覆盖关键 API
- 单元测试覆盖 > 80%
- 代码复用率 > 70%（DRY）
- 无外部运行时依赖（仅 `@oh-my-pi/resolve-pi`）
- 兼容 oh-my-pi 插件规范
- 纯 JavaScript（前后端统一）

## 9.3 里程碑

### Phase 1: 核心引擎（28 个服务端文件）
- [ ] Constants & 状态机：`constants.js`, `state-machine.js`（含测试）
- [ ] 事件总线：`event-bus.js`（含测试）
- [ ] 模型池：`model-pool.js`, `model-pool-config.js`, `model-pool-events.js`（含测试）
- [ ] DAG 引擎：`dag-validate.js`, `dag-sort.js`, `dag-execute.js`, `dag-concurrency.js`（含测试）
- [ ] 节点执行器：`run-node.js`, `run-worker.js`, `run-worker-prompt.js`, `run-confirm.js`, `run-confirm-prompt.js`, `run-reviewer.js`, `run-reviewer-prompt.js`（含测试）
- [ ] 辅助模块：`session-registry.js`, `squad-fsm.js`, `empty-turns.js`, `tamper-detection.js`（含测试）
- [ ] 外层控制：`outer-review.js`, `retry-logic.js`, `submit-plan.js`, `validate-plan.js`
- [ ] Squad 引擎：`squad-engine.js`（命令注册 + FSM 编排）
- [ ] 网络层：`http-server.js`, `ws-server.js`, `ws-handler.js`, `ws-heartbeat.js`, `ws-events.js`, `vite-setup.js`

### Phase 2: Web UI（21 个前端文件）
- [ ] HTTP + WebSocket 服务器（network layer from Phase 1）
- [ ] 前端脚手架：`index.html`, `vite.config.js`, `main.jsx`, `App.jsx`, `App.css`, `types.js`
- [ ] Hooks：`useWebSocket.js`, `useWebSocket-events.js`, `useSquadState.js`, `useSessionState.js`, `useModelPool.js`, `useAutoScroll.js`, `useDarkMode.js`
- [ ] 基础布局：`Header.jsx`, `Sidebar.jsx`, `StatusBar.jsx`
- [ ] 侧边栏：`SessionTree.jsx`
- [ ] 主内容：`MainContent.jsx`, `MessageList.jsx`, `MessageItem.jsx`, `MessageInput.jsx`
- [ ] 消息组件：`ThinkingBlock.jsx`, `ToolCall.jsx`
- [ ] DAG View：`DAGView.jsx`（Mermaid）
- [ ] 状态/错误：`WelcomeView.jsx`, `ErrorBanner.jsx`
- [ ] 模型池：`ModelPoolDrawer.jsx`

### Phase 3: 测试
- [ ] 集成测试：squad 完整流程
- [ ] 集成测试：WebSocket 通信
- [ ] 端到端测试：独立模式（Puppeteer standalone）
- [ ] 端到端测试：OMP 内部模式（Puppeteer 内嵌）
- [ ] 端到端测试：OMP RPC 模式（rpc-e2e.test.js）
- [ ] 错误场景覆盖

### Phase 4: 文档与优化
- [ ] README.md
- [ ] SPEC.md
- [ ] 虚拟滚动优化
- [ ] 断线重连完善
- [ ] 性能基准测试

## 9.4 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebSocket 消息丢失 | 低 | 单 WS 连接天然有序，丢失场景极少；UI 最终一致性可接受 |
| 浏览器性能瓶颈（大量消息） | 中 | delta 渲染 + 消息列表虚拟滚动 |
| 模型池配置并发冲突 | 低 | 服务端单线程 EventLoop 处理所有 update |
| 外层 review 无限循环 | 低 | 用户可随时 abort (Esc/Ctrl+C) |
| 文件篡改误报 | 低 | 使用 mtime 检测 |
| 用户消息发给已结束 session | 低 | 服务端校验 session 状态，错误事件通知浏览器 |

## 9.5 已决策事项（源自讨论点）

| # | 讨论点 | 决策 |
|---|--------|------|
| 1 | 会话 ID | 自然数递增（1, 2, 3, ...） |
| 2 | 事件序列保证 | 依赖单条 WebSocket 连接天然有序，无序列号/ack/重传 |
| 3 | tool_result 大小 | 不处理，模型上下文窗口自然限制 |
| 4 | 模型池空 | 回落到当前会话模型 |
| 5 | Worker 模型分配 | 优先模型池，池空则用当前会话模型；当前模型用量无上限 |
| 6 | 并发度 | 无限，只受模型池槽位数限制 |
| 7 | Retry 回退 | 无退避，立即重试 |
| 8 | Blueprint Tree 性能 | 不用焦虑，但必须增量更新（不全量设 contents） |
| 9 | Mermaid 重绘 | 只在节点状态变更时重绘，不因无关事件触发 |
| 10 | 移动端适配 | best effort，不单独开发，DRY |
| 11 | 多 Tab 切换 | 各 Tab 独立管理自己的 auto-switch 状态 |
| 12 | OMP 内部 e2e | 直接在 OMP 内测试 |
| 13 | Puppeteer | devDependency |
| 14 | 集成测试 mock | 按需 mock OMP 框架 |
| 15 | 前端构建 | Dev 模式直读源码，不打包；前后端分离开发，联调时 e2e |
| 16 | 语言 | 全部 JavaScript（JSX），无 TypeScript |
| 17 | 最终 e2e 测试方式 | 使用 `omp --mode rpc` JSON-RPC 模式驱动 OMP 运行时，不 mock pi，不依赖浏览器，最接近真实运行环境 |

## 9.6 已决策事项（补充）

| # | 讨论点 | 决策 |
|---|--------|------|
| 18 | React 版本 | 18.3.x（与 Blueprint 6 peerDep 一致） |
| 19 | Blueprint.js 版本 | 6.12.x + @blueprintjs/icons@6.9.x |
| 20 | Mermaid 版本 | 11.14.x |
| 21 | Vite 版本 | 8.0.x（最新稳定版） |
| 22 | UI: DAG 位置 | 主内容区顶部可折叠面板，不放侧栏 |
| 23 | UI: Session Tree | 双层标准树，节点 → 执行阶段，每个阶段可点击切换会话 |
| 24 | UI: Thinking 渲染 | `requestAnimationFrame` 合批，丝滑无停顿 |
| 25 | UI: 消息角色区分 | 左边框色带：主/蓝、Worker/绿、Reviewer/橙、Outer/紫 |
| 26 | UI: Tool 卡片折叠 | 最新展开，旧的折叠 |
| 27 | UI: Auto-scroll | 用户滚动后暂停，显示 `↓ Scroll to bottom` 浮动按钮 |
| 28 | UI: 空状态 | 欢迎引导 |
| 29 | UI: Header | Abort 仅活跃时显示，连接状态简化为绿/红点 |
| 30 | UI: 深色模式 | 自动跟随系统主题，Blueprint `Classes.DARK` |
| 31 | Vite Dev 模式 | 调用 `vite.createServer` Node API 直读 JSX |
| 32 | 端口分配 | 默认 9527，冲突 +1 递增 |
| 33 | 图标选择 | 所有图标使用 Blueprint `Icon` 组件 + `@blueprintjs/icons` 的 `IconNames` 枚举，实现在 https://blueprintjs.com/docs/#icons/icons-list 中挑选最贴合语义的，不将就 |

## 9.7 待决策事项

无。所有问题已决策。
