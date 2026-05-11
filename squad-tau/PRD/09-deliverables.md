# Squad-Tau PRD — 09 交付物与里程碑

## 9.1 交付物清单

- [x] PRD 文档（本文件集）
- [x] `squad-tau/` 完整源码（server + client + test）
  - [x] 服务端：引擎、DAG 执行器、节点执行、网络层、模型池、基础设施
  - [x] 前端：React SPA、Blueprint.js 组件、hooks
  - [x] 配置：`package.json`, `shim.mjs`, `README.md`, `SPEC.md`
- [x] 单元测试（28 个文件，260+ 用例，Bun Test）
  - [x] 状态机 70 / 事件总线 12 / DAG 排序 12 / DAG 验证 21
  - [x] 模型池基础 7 / 动态 10 / 配置 5
  - [x] squad-fsm 10 / run-worker 4 / run-reviewer 5
  - [x] outer-review 4 / retry-logic 4 / validate-plan 10 / session-registry 5
  - [x] 审计轮次：round2 10 / round3 10 / round4 6 / bugs-4-7 8 / final-bugs 4
  - [x] 杂项：deps 3 / dead-code 2 / duplicate-code 2 / null-safety 3 / http-server 4 / vite-middleware 3 / event-bus-integration 6
- [x] 集成测试（mock pi，`.skip.js`）
  - [x] `squad-flow.skip.js` / `websocket.skip.js` / `run-confirm.skip.js`
- [ ] 端到端测试（需真实 OMP/Puppeteer，`.skip.js`）
  - [ ] `browser.skip.js` / `standalone.skip.js` / `rpc-e2e.skip.js` / `chaos-e2e.skip.js`

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
- [x] 全部 server/：引擎、DAG、节点执行、网络层、模型池、基础设施

### Phase 2: Web UI
- [x] 全部 client/：React 组件、hooks、reducer、样式

### Phase 3: 测试
- [x] 单元测试 260+ 用例通过
- [x] 集成测试 3 文件通过
- [ ] 端到端测试（需真实 OMP/Puppeteer）

### Phase 4: 文档与优化
- [x] README.md + SPEC.md
- [x] 虚拟滚动：CSS `content-visibility: auto`
- [x] 断线重连：指数退避 1s→30s
- [x] 性能基准：EventBus 3M/s / ModelPool 2.6M/s / 状态机 12M/s

## 9.4 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebSocket 消息丢失 | 低 | 单 WS 连接天然有序，丢失场景极少；UI 最终一致性可接受 |
| 浏览器性能瓶颈（大量消息） | 中 | delta 渲染 + 消息列表虚拟滚动 |
| 模型池配置并发冲突 | 低 | 服务端单线程 EventLoop 处理所有 update |
| 外层 review 无限循环 | 低 | 用户可随时 abort (Esc/Ctrl+C) |
| 文件篡改 | 低 | 已移除（v1.1.0 设计变更） |
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

## 9.8 设计变更记录

### v1.1.0 — 2026-05-10 设计变更

| # | 变更 | 旧设计 | 新设计 | 影响文件 |
|---|------|--------|--------|---------|
| 34 | 工具集固定 | session 可通过 reopen file 换工具集 | 创建时固定，永不改变 | 删除 `run-confirm.js`，`run-confirm-tools.js`，`run-confirm-prompt.js` 合并入 `run-worker.js` |
| 35 | Self-confirm 机制 | 独立的 confirm 工具 + return_work 重提交 | `return_work` 首次调用进入 self-confirm，第二次调用真正返回。无 `confirm` 工具 | 删除 `run-confirm.js`, `run-confirm-tools.js`；`lifecycle-tools.js` 只保留 `return_work` |
| 36 | 主会话工具集 | 通过 toolBuilders 注入 submit_plan | 同左，但确认工具集固定 | `squad-engine.js` 使用 `customTools` 而非 `toolBuilders` |
| 37 | SessionManager.open | `runConfirmSession` 使用 `SessionManager.open()` 复用 session 文件 | 不再 reopen 任何 session 文件。confirm 直接 `session.prompt()` 在已有 session 上 | 删除所有 `SessionManager.open()` 调用 |
| 38 | 模型匹配 | `modelSlot.id` vs `modelSlot.modelId` 不匹配 | 修复为 `modelSlot.modelId` | `session-options.js` |
| 39 | 模型池空角色 | acquire 在角色槽位为空时阻塞 | 返回 null → 回落到当前会话模型 | `model-pool.js` |
| 40 | 外层 review 反馈 | 通过 `ctx.sendMessage()` 丢失给 agent | 通过 submit_plan tool 返回值传递给 agent | `submit-plan.js` 内联外层 review |
| 41 | agent_end 守卫 | `session.on('agent_end')` 无效 | 改用 `session.isStreaming` + 轮询模式 | `squad-engine.js` |
| 42 | 文件篡改检测 | mtime 快照对比 | 完全移除。不再需要防篡改 | 删除 `tamper-detection.js` |
| 43 | Reviewer session | 无特殊要求 | 每次 retry 都创建新 session（`SessionManager.create()`） | `run-reviewer.js` |
| 44 | Worker session 复用 | 同一 session 多次 prompt | 同一 session 两次 `return` 调用，不创建新 session | `run-worker.js` |
| 45 | 工具名统一 — submit | `submit_plan` | `delegate` | `submit-plan.js` → 改名为 delegate 工具 |
| 46 | 工具名统一 — lifecycle | `return_work` / `approve` / `reject` 三个工具 | 统一为 `return({ status, reason, affected_files? })` | 删除 `reviewer-tools.js`，合并入 `lifecycle-tools.js` |
| 47 | return 参数 | worker 有 `summary` 字段 | worker 无 summary，摘要写入 `reason`。`status: 'ok'`+reason = 成功，`status: 'error'`+reason = 失败/驳回 | `lifecycle-tools.js` |
| 48 | 全局工具注册 | per-session customTools / toolBuilders 注入 | `pi.registerTool()` 全局注册，所有 session 共享 `delegate` + `return` | 删除 `reviewer-tools.js`，`squad-engine.js` 不再注入 customTools |
| 49 | main session 可用工具 | 有限工具集 | 也可调用 `return`（`status: 'error'` = redo） | `lifecycle-tools.js` |
| 50 | subsession 可用工具 | 只含 lifecycle 工具 | 也可调用 `delegate` | 全局注册后自动可用 |
| 51 | 模型池路径 | `~/.omp/squad/models.json` | `{cwd}/.omp/models.toml` | `model-pool-config.js` |
| 52 | delegate 参数 | `({ mode, reasoning, nodes })` inline JSON | `({ plan_dir })` 指向节点 `.toml` 文件目录；单文件=M，多文件=L | `submit-plan.js` |
| 53 | HTTP/WS 启动时机 | 随 `/squad` 启动 | 插件加载时即启动，始终可用 | `squad-engine.js` |
| 54 | delegate 可用性 | 仅在 squad 任务中 | 始终全局注册，LLM 可随时自主调用 | `lifecycle-tools.js` |
| 55 | /squad 语义 | 启动服务 + 激活工具 | 仅修改提示词 + 强制 LLM 调 delegate | `squad-engine.js` |
