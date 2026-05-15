# Squad-Tau PRD — 04 Web UI 实时镜像

**核心哲学**：UI 是完全的贫血投影（Anemic Projection）。React 不维护任何业务状态、无 `useState` 局部状态、无 Reducer 计算逻辑。**前后端同构投影（CQRS）**——WebSocket 推送的事件数组直接输入到共享的 `applyEvent` 函数，React 的渲染只需 O(1) 地绑定这个折叠后的 State 对象。

**所有用户交互（包括侧边栏切换、折叠面板、对话框开闭）都通过 `ui:xxx` 事件进入 EventStore**。React 组件内部不存在任何对于业务状态的 `useState` 或 `useContext`。

## 4.1 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | React | 18.3.x |
| UI 组件 | @chakra-ui/react | 3.x |
| 图标 | lucide-react | latest |
| DAG 可视化 | beautiful-mermaid | latest |
| 通信 | WebSocket (原生) | — |
| 构建 | vite | 8.0.x |
| 语言 | JavaScript (JSX) | — |

## 4.2 架构原则

- **无业务状态**：React 不维护任何 squad 业务逻辑。所有状态来自同构投影 `shared/projections.js`。
- **无 `useState`/`useContext`**：侧边栏展开/折叠、Drawer 开闭、DAG 视图切换等所有 UI 状态通过 `ui:xxx` 事件 → EventStore 折叠 → `useSyncExternalStore` O(1) 绑定。组件内部仅存储 ref 和 RAF 句柄。
- **同构投影（CQRS）**：前端通过 `event-store.js` 维护一个 EventLog 副本。每次收到 WebSocket 事件，调用 `shared/projections.js` 的 `applyEvent()` 增量折叠。React 组件直接绑定 fold 结果。
- **原子化微订阅**：使用 `useSyncExternalStore` 订阅 `event-store.js` 的单个键路径。组件仅订阅自己渲染所需的最小字段，不订阅整个 state 对象。消息列表的每一条消息由独立 `MessageItem` 组件订阅自己的 `messageId` 字段——十万条消息更新时，仅被影响的那一条触发重渲染，其余组件 O(1) 跳过。
- **Delta 渲染**：只传输增量数据（新消息、状态变更），不全量同步。前端通过 `sync` 请求（携带上一次收到的 seq）在断线重连后补齐。
- **事件驱动**：状态变更即刻推送，无需客户端轮询或刷新。
- **单向数据流**：用户操作（消息、模型池配置修改）→ WebSocket → EventLog 追加 → Engine Pulse → Reactor 推导 → Projection → React 重新绑定。

### 数据流全景

```mermaid
graph LR
    WS[WebSocket] --> ES[event-store<br/>Map&lt;string, any&gt;]
    ES --> AE[applyEvent
    prevState + event → newState]
    AE --> SN[useSyncExternalStore
    原子化路径订阅 getSnapshot]
    SN --> UI[Chakra UI 组件绑定]
```

## 4.3 UI 布局

布局：上 Header（品牌标识 + 连接状态 + 操作按钮），下分 Sidebar（Session Tree 双层树）和 Main Content（顶部 DAG View 可折叠 + 消息列表 + 底部输入框）。

## 4.4 侧边栏（Sidebar）

### Sessions Tree（扁平混合树）
- Chakra 混合布局：顶部 "DAG Overview" 节点（带 `Network` 图标）→ 按 nodeId 分组的 Node → 阶段子节点 → 无 nodeId 的游离 session
- **增量更新**：Tree contents 由 `useMemo` 从 sessions + nodes 重新计算
- **排序规则**：两层均按 session 创建时间升序排列（自然数 session ID 递增即创建时间升序）
- 各状态使用 lucide-react 图标

### 导航逻辑
- **从不自动切换**：用户始终手动选择要查看的会话，不存在 auto-follow 或锁定的概念
- 点击侧边栏树节点 → 发送 `ui:select_session` 事件 → EventStore 折叠 → 组件重新绑定 `state.ui.activeSessionId`
- 点击 "DAG Overview" → 发送 `ui:set_view_mode { viewMode: 'dag' }` 事件

## 4.5 Header

- **左侧**：`Squad-Tau` 品牌标识
- **中间**：连接状态指示器，显示端口号，使用 Chakra `Badge` + lucide `Wifi` / `WifiOff` 图标
- **右侧**：模型池配置按钮（Cog 图标）+ Abort 按钮（Stop 图标，仅在 squad 活跃时显示）
- **深色**：跟随系统 `prefers-color-scheme`，Chakra 内置 color mode

## 4.6 主内容区（MainContent）

### DAG View（全屏视图）
- 使用 `beautiful-mermaid` 渲染 SVG
- 仅在 `squad:node_state` 事件引起 state 变更时重绘，不因无关事件触发

### 消息渲染
- **角色区分**：不同角色使用不同左边框色带：主会话蓝色、Worker 绿色、Reviewer 橙色、Outer Review 紫色
- **User 消息**：右对齐，蓝色背景
- **Assistant 消息**：左对齐，默认背景
- **System 消息**：居中，斜体，灰色
- **Thinking 块**：可折叠（Chakra `Collapse` 组件）
- **Tool 调用**：使用 Chakra 风格卡片，默认全部折叠

### RAF 双缓冲（流式渲染的终极形态）

高频 Thinking delta 通过 RAF 双缓冲机制直接写入 DOM，绕过 React State 更新链：

```mermaid
graph LR
    WS[WebSocket<br/>session:message_delta] --> ES[event-store.applyEvent]
    ES --> PROJ[projections.js
    更新 joinedText / joinedThinking
    纯字符串拼接]
    PROJ --> RAF[RAF 回调
    读取当前帧 joinedText]
    RAF --> DOM[直接写入
    DOM textContent
    O(1)]
```

**关键优化**：
- **`joinedText` 和 `joinedThinking` 预计算缓存**：`session:message_delta` 到达时，projections.js 直接将增量追加到 `msg.joinedText` 或 `msg.joinedThinking` 字符串。渲染帧内不需要 `.filter().map().join()` 遍历数组——缓存已在投影阶段维护好。
- **RAF 合并**：delta 可能在一次微任务中多次到达，RAF 仅每帧触发一次写入，合并所有中间 delta。
- **仅对流式消息生效**：非流式消息（`session:message`）正常走 React 更新路径。

### Auto-scroll 行为
- 默认自动跟随最新消息
- 当用户手动向上滚动查看历史时，自动滚动暂停
- 用户向上滚动后，底部显示浮动按钮（lucide `ArrowDown` 图标），点击恢复自动跟随
- 使用 `requestAnimationFrame` 合并滚动操作

### 空状态
无 squad 运行时显示欢迎引导：
- 标题："Welcome to Squad-Tau"
- 说明："Type `/squad <task>` in your terminal to start."
- 按钮：模型池配置按钮

### 消息输入

消息列表底部显示输入区域**仅当有活跃 session 时**（`MainContent.jsx` 中 `{activeSession && <MessageInput .../>}`）。

- Chakra `Textarea`（支持多行）+ `Button`（发送），支持 Enter 发送，Shift+Enter 换行
- 消息通过 WebSocket 发送 `session:user_message`
- 使用乐观消息（messageId 以 `opt_` 前缀）立即显示

## 4.7 模型池配置面板

- Chakra `Drawer` 组件（从右侧滑出）
- 点击 Header 的模型池配置按钮 → 发送 `ui:toggle_drawer { open: true }` 事件

### 配置
- 仅包含 `maxWorkers` 滑块/输入框
- 实时生效：每次操作发送 `model_pool:update` → 服务端处理 → `model_pool:changed` 广播

## 4.8 深色模式

- 自动跟随系统主题：`matchMedia('(prefers-color-scheme: dark)')`
- 所有组件继承 Chakra 原生暗色主题，无需额外样式

## 4.9 移动端适配
- 最佳努力（best effort）支持，不单独开发移动端 UI
- 利用 Chakra 原生响应式能力

## 4.10 安全

- HTTP + WebSocket 服务器默认绑定 `127.0.0.1`（仅本地可访问）
- 不实现身份认证——绑定 localhost 已满足单用户场景安全性
