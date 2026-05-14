# Squad-Tau PRD — 09 交付物与里程碑

## 9.1 交付物清单

- [x] PRD 文档（本文件集）
- [x] `squad-tau/` 完整源码（server + client + shared + test）
  - [x] 服务端：EventLog、Engine、Reactor、SideEffects、网络层、模型池配置
  - [x] 前端：React SPA、Chakra UI 组件、hooks、event-store
  - [x] 共享：前后端同构 projections.js + events.js
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
- [x] 真实环境混沌测试（`test/real-env/` + `test/e2e/`）
  - [x] `real-environment.test.js` — 基础链路
  - [x] `real-env-chaos.test.js` — 混沌测试
  - [x] `chaos-ui-e2e.test.js` — 浏览器端混沌
  - [x] `rpc-e2e.test.js` — OMP RPC 模式
  - [x] `ui-full-flow.test.js` — UI 全流程
- [x] 客户端测试（`test/helpers/`）
  - [x] `state-builder.js` — 代数断言 State 构造器
  - [x] `assertions.js` — 通用断言

## 9.2 非功能需求

### 性能
- WebSocket 消息频率 > 100/s，无丢失
- 10 节点并发执行，浏览器不卡顿
- 100 条消息的会话流畅（内容可见性优化 `content-visibility: auto`）
- Reactor 推导 < 1ms（纯函数 O(n)），100 节点 State 树推导在微秒级

### 可靠性
- WebSocket 断开自动重连（指数退避：[1000, 2000, 4000, 8000, 16000, 30000]，`MAX_RECONNECT_ATTEMPTS=50`）
- 服务端异常 → 浏览器显示错误提示，自动重连
- EventLog 追加始终幂等——断线重连后全量回放无副作用

### 可用性
- 首次页面加载 < 2s（Vite 构建产物）
- 状态变更 UI 延迟 < 100ms（WebSocket → applyEvent → React 绑定）
- 模型池配置变更立即生效

### 可维护性
- JSDoc 类型注释覆盖关键 API
- 代数断言测试覆盖 Reactor 全部规则分支
- 无外部运行时依赖（仅 `@oh-my-pi/resolve-pi`）
- 兼容 oh-my-pi 插件规范
- 纯 JavaScript（前后端统一）
- **零旧架构词汇**：无 FSM、EventBus、拓扑排序、等待队列

## 9.3 里程碑

### Phase 1: 核心引擎
- [x] 全部 server/：EventLog、Engine、Reactor、SideEffects、网络层、模型池

### Phase 2: Web UI
- [x] 全部 client/：React 组件、hooks、event-store、样式

### Phase 3: 测试
- [x] 代数断言 50+ 场景
- [x] 时空折叠器全覆盖
- [x] 真实环境混沌测试

### Phase 4: 文档与优化
- [x] README.md + SPEC.md
- [x] 虚拟滚动：CSS `content-visibility: auto`
- [x] 断线重连：指数退避 1s→30s
- [x] Reactor 推导基准：O(n) 随节点数线性扩展

## 9.4 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebSocket 消息丢失 | 低 | 单 WS 连接天然有序；丢失场景极少；UI 最终一致性可接受 |
| 浏览器性能瓶颈（大量消息） | 中 | delta 渲染 + 消息列表虚拟滚动 |
| 模型池配置并发冲突 | 低 | 服务端单线程 EventLoop + EventLog 序列化所有操作 |
| 外层 review 无限循环 | 低 | 用户可随时 abort (Esc/Ctrl+C) |
| Reactor 无限推导（死循环） | 低 | Engine Pulse 无新 Action 时自然收敛；过渡态事实防护 |

## 9.5 已决策事项

| # | 讨论点 | 决策 |
|---|--------|------|
| 1 | 会话 ID | 自然数递增（1, 2, 3, ...） |
| 2 | 事件序列保证 | 依赖单条 WebSocket 连接天然有序，无序列号/ack/重传 |
| 3 | tool_result 大小 | 不处理，模型上下文窗口自然限制 |
| 4 | 模型池空 | 回落到当前会话模型 |
| 5 | Worker 模型分配 | 优先模型池，池空则用当前会话模型；当前模型用量无上限 |
| 6 | 并发度 | 无限，只受模型池槽位数限制 |
| 7 | Retry 回退 | 无退避，立即重试 |
| 8 | Sidebar Tree 性能 | 不用焦虑，但必须增量更新（不全量设 contents） |
| 9 | Mermaid 重绘 | 只在节点状态变更时重绘，不因无关事件触发 |
| 10 | 移动端适配 | best effort，不单独开发，DRY |
| 11 | 多 Tab 切换 | 各 Tab 独立管理自己的 auto-switch 状态 |
| 12 | 前端构建 | Dev 模式直读源码，不打包 |
| 13 | 语言 | 全部 JavaScript（JSX），无 TypeScript |
| 14 | 核心架构 | EventLog 真相源 + Reactor 纯函数推导 + Projections 增量折叠 |
| 15 | React 版本 | 18.3.x |
| 16 | Chakra UI 版本 | 3.x + lucide-react latest |
| 17 | Vite 版本 | 8.0.x（最新稳定版） |
| 18 | UI: DAG 位置 | 主内容区顶部可折叠面板，不放侧栏 |
| 19 | UI: Session Tree | 双层标准树，节点 → 执行阶段 |
| 20 | UI: Thinking 渲染 | `requestAnimationFrame` 合批，丝滑无停顿 |
| 21 | UI: 消息角色区分 | 左边框色带：主/蓝、Worker/绿、Reviewer/橙、Outer/紫 |
| 22 | UI: Tool 卡片折叠 | 全部折叠 |
| 23 | UI: Auto-scroll | 用户滚动后暂停，显示浮动按钮 |
| 24 | UI: 空状态 | 欢迎引导 |
| 25 | UI: Header | Abort 仅活跃时显示，连接状态简化为绿/红点 |
| 26 | UI: 深色模式 | 自动跟随系统主题，Chakra colorMode |
| 27 | 端口分配 | OS 随机分配（`server.listen(0)`） |
| 28 | 图标选择 | 所有图标使用 lucide-react SVG 图标 |
| 29 | Empty pool bypass | 角色槽位数=0 → 跳过模型池，直接创建 session |
| 30 | Model pool 降维 | 无 ModelPool 类，纯 EventLog 投影 + Reactor 推导 |
| 31 | 测试架构 | 代数断言 + 时空折叠器 + 真实混沌 |

## 9.6 设计变更记录

| # | 变更 | 旧设计 | 新设计 |
|---|------|--------|--------|
| 1 | 架构模式 | EventBus + FSM + Orchestrator | EventLog + Reactor pure f(State) + Projections |
| 2 | 并发控制 | Kahn 拓扑排序 + 分层队列 + Promise.race 信号量 | Reactor 声明式依赖规则，并发由槽位差值自然收敛 |
| 3 | 模型池 | `ModelPool` 类 + async acquire/release + 等待队列 | 数学计数器（EventLog 投影）+ 纯事实驱动 |
| 4 | 前端状态 | Reducer 含计算逻辑（nodeHistory、isFulfilled） | 绝对贫血：applyEvent() → React O(1) 绑定 |
| 5 | Reactor 输入 | 扫描 EventLog 历史（getSince + find） | 仅输入折叠后的扁平 State 对象 |
| 6 | 测试策略 | Puppeteer DOM 轮询 + Mock 等待时序 | 代数断言 + 时空折叠器 + 真实混沌 |
| 7 | WebSocket 路由 | 通过 EventBus 桥接 | EventLog subscribe 直连广播 |
| 8 | 空池处理 | ModelPool 返回 null | Reactor 检测 slots.length === 0 → 跳过 acquire |
| 9 | 外层 review 重置 | 手动节点重置逻辑 | Reactor 自动推导 |
