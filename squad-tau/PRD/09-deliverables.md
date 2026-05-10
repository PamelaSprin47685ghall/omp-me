# Squad-Tau PRD — 09 交付物与里程碑

## 9.1 交付物清单

- [x] PRD 文档（本文件集）
- [ ] `squad-tau/` 完整源码
  - [ ] 插件入口 `index.js` + `shim.mjs`
  - [ ] 服务端：`server/http-server.js`, `server/event-bus.js`, `server/squad-engine.js`, `server/dag-executor.js`, `server/node-runner.js`, `server/model-pool.js`, `server/state-machine.js`, `server/outer-review.js`, `server/session-router.js`
  - [ ] 客户端：`client/src/` + `client/index.html` + `client/vite.config.ts` + `client/package.json`（含 `MessageInput.jsx`）
  - [ ] 配置：`package.json` + `README.md` + `SPEC.md`
- [ ] 单元测试（> 80% 覆盖）
  - [ ] `state-machine.test.js`
  - [ ] `dag-executor.test.js`
  - [ ] `model-pool.test.js`
  - [ ] `event-bus.test.js`
  - [ ] `node-runner.test.js`
- [ ] 集成测试（核心流程覆盖）
  - [ ] `squad-flow.test.js`（M 模式、L 模式、外层 review）
  - [ ] `websocket.test.js`（通信、多客户端）
- [ ] 端到端测试
  - [ ] `browser.test.js`（OMP 内部 Puppeteer）
  - [ ] `standalone.test.js`（独立 Puppeteer 执行）
  - [ ] `rpc-e2e.test.js`（OMP RPC 模式，最终集成测试）
  - [ ] `helpers/puppeteer-setup.js`
  - [ ] `helpers/mock-pi.js`
  - [ ] `helpers/rpc-client.js`
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

### Phase 1: 核心引擎
- [ ] 状态机（含测试）
- [ ] DAG 执行器（含测试）
- [ ] 模型池（含测试）
- [ ] 事件总线（含测试）
- [ ] 节点执行器
- [ ] Squad 引擎（命令注册 + FSM）
- [ ] 外层 review
- [ ] `submit_plan` 工具

### Phase 2: Web UI
- [ ] HTTP + WebSocket 服务器
- [ ] React 项目脚手架（Vite + TypeScript + Blueprint）
- [ ] WebSocket hook（useWebSocket）
- [ ] 基础布局（Header + Sidebar + MainContent）
- [ ] 侧边栏：Session Tree
- [ ] 主内容：消息流
- [ ] 消息输入框：MessageInput 组件，支持向任意活跃 session 发送用户消息
- [ ] Thinking 块流式渲染
- [ ] Tool 调用卡片
- [ ] DAG View（Mermaid）
- [ ] 模型池配置面板
- [ ] 自动会话切换

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
