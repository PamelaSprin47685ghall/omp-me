# Squad-Tau PRD — 04 Web UI 实时镜像

### 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | React | 18.3.x |
| UI 组件 | @blueprintjs/core | 6.12.x |
| 图标 | @blueprintjs/icons | 6.9.x |
| DAG 可视化 | beautiful-mermaid | latest |（基于 mermaid 但内置暗色主题支持） |
| 通信 | WebSocket (原生) | — |
| 构建 | vite | 8.0.x |
| 语言 | JavaScript (JSX) | — |

## 4.2 架构原则

- **无 proxy**：直接在 oh-my-pi 进程内启动 HTTP + WebSocket 服务器
- **无文件轮询**：所有状态变更通过 WebSocket 事件推送，天然防抖
- **Delta 渲染**：只传输增量数据（新消息、状态变更），不全量同步
- **事件驱动**：状态变更即刻推送，无需客户端轮询或刷新

## 4.3 UI 布局

布局：上 Header（品牌标识 + 连接状态 + 操作按钮），下分 Sidebar（Session Tree 双层树）和 Main Content（顶部 DAG View 可折叠 + 消息列表 + 底部输入框）。

## 4.4 侧边栏（Sidebar）

### Sessions Tree（扁平混合树）
- Blueprint `Tree` 组件，混合单层结构：顶部的 "DAG Overview" 节点 → 按 nodeId 分组的 Node（一级）→ 阶段子节点（二级）→ 无 nodeId 的游离 session
- **增量更新**：Tree contents 由 useMemo 从 sessions + nodes 重新计算
- **排序规则**：两层均按 session 创建时间升序排列（自然数 session ID 递增即创建时间升序）
  - 第一层（Node）：节点按首次出现的 order 排列
  - 第二层（Phase）：子节点按 session 创建时间升序排列
- 结构：顶层 "DAG Overview" → Node 一级 → `R<retryCount+1> <phase>` 二级 → 游离 session
- 所有图标使用 Blueprint `Icon` 组件 + `@blueprintjs/icons` 的 `IconNames` 枚举
- 各状态图标意图：
  - approved → tick-circle, rejected → cross-circle, pending → time
  - active/authoring/confirming/reviewing → refresh
  - failed/blocked → ban-circle

### 导航逻辑
- **从不自动切换**：用户始终手动选择要查看的会话，不存在 auto-follow 或锁定的概念
- 点击侧边栏树节点 → 切换到该会话
- 顶部 "DAG Overview" 节点（点击切换到 DAG 视图）→ 节点 Node（一级）→ 阶段 Phase（二级）→ 无 nodeId 的 session 直接作为顶层
- 二级节点标签：`R<retryCount+1> <phase>`（例如：R1 worker、R2 reviewer）
- 无 nodeId 的 session 显示为 "Outer Review" 或 "Architect"
- 所有图标使用 Blueprint `Icon` 组件 + `@blueprintjs/icons` 的 `IconNames` 枚举
- 各状态图标意图：approved → tick-circle, rejected → cross-circle, pending → time, active/authoring/confirming/reviewing → refresh, failed/blocked → ban-circle

## 4.5 Header

- **左侧**：`Squad-Tau` 品牌标识
- **中间**：连接状态指示器，显示端口号，使用 Blueprint `Tag` + `Icon`，绿色 (SIGNAL_SEARCH) 表示已连接，红色 (OFFLINE) 表示断连
- **右侧**：模型池配置按钮（Cog 图标）+ Abort 按钮（Stop 图标，仅在 squad 活跃时显示，点击不可逆）
- **深色**：跟随系统 `prefers-color-scheme`，应用 Blueprint `Classes.DARK`
- 无 DAG 切换按钮：DAG 通过侧边栏 "DAG Overview" 节点切换

## 4.6 主内容区（MainContent）

### DAG View（全屏视图）
- 通过侧边栏 "DAG Overview" 节点或点击 DAG 节点进入
- 占满整个主内容区，使用 `beautiful-mermaid` 渲染 SVG
- DAG 显示所有节点及其依赖关系，状态变更更新节点颜色
- 点击 DAG 节点 → 跳转到对应 worker/reviewer 会话（查找该节点的 session 并切换）
- 状态变更更新：`squad:node_state` 事件触发重绘，不因无关事件触发

### 消息渲染
- **角色区分**：不同角色使用不同左边框色带：
  - 主会话：蓝色 (`#2B95D6`)
  - Worker：绿色 (`#238551`)
  - Reviewer：橙色 (`#D9822B`)
  - Outer Review：紫色 (`#7157D9`)
- **User 消息**：右对齐，Blueprint `Intent.PRIMARY` 背景
- **Assistant 消息**：左对齐，`Intent.NONE` 背景
- **System 消息**：居中，斜体，灰色
- **Thinking 块**：
  - 可折叠（Blueprint `Collapse` 组件）
  - 实时流式渲染：WebSocket 推送 `session:message_delta` 时，通过 `requestAnimationFrame` 合并 delta 批量追加，不每帧操作 DOM
  - 流式更新丝滑无停顿，展开状态跨消息保持
- **Tool 调用**：
  - Blueprint `Card` 组件
  - **默认全部折叠**（`useState(false)`），代码行为与 PRD 设计不同——所有 tool call 卡片初始均为折叠状态，不区分新旧
  - 显示 tool 名称、参数（JSON 格式化）、结果
  - 结果可点击展开/折叠
  - 工具调用期间显示 `running` Tag（无 `Spinner` 动画）
  - 错误结果自动展开并以红色高亮（错误结果 `Collapse isOpen` 由 `isError` 单独标记，实际代码不自动展开）

### Auto-scroll 行为
- 默认自动跟随最新消息
- 当用户手动向上滚动查看历史时，自动滚动暂停
- 用户向上滚动后，底部显示浮动按钮（使用 Blueprint `Icon`，语义为"回到最新消息"，点击恢复自动跟随
- 使用 `requestAnimationFrame` 合并滚动操作，避免 Thinking delta 高频更新导致页面跳跃
- 恢复逻辑：当 `scrollTop + clientHeight >= scrollHeight - 100px` 时，自动恢复跟随

### 状态指示器
- 当前节点：`Node: <id> · R<retry> · <phase>`
- 进度条：`Layer 2/4`（L 模式）
- 状态标记：`Intent` 颜色指示

### 空状态
无 squad 运行时显示欢迎引导：
- 标题："Welcome to Squad-Tau"
- 说明："Type `/squad <task>` in your terminal to start."
- 按钮：模型池配置按钮（使用设置图标）

### 错误状态
- 当 squad 整体失败（节点 blocked/failed）时，DAG 视图顶部显示全宽错误 banner
- 使用 Blueprint `Alert` 组件，`intent="danger"`，标题 `Squad Failed`
- banner 显示失败节点数量（failed/blocked 分别计数）、第一个失败节点的 summary 作为原因
- 用户可手动关闭 banner（`onDismiss`）
- Squad 成功完成时显示 `success` intent 的 Callout
- 其他错误（WebSocket 断连、服务端崩溃）通过 Header 连接状态指示器展示

### 消息输入

消息列表底部显示输入区域**仅当有活跃 session 时**（`MainContent.jsx` 中 `{activeSession && <MessageInput .../>}`），不显示无 session 状态的输入框。

- Blueprint `TextArea`（支持多行）+ `Button`（发送），支持 Enter 发送，Shift+Enter 换行
- 输入框占满宽度，发送按钮固定在右侧
- 发送后清空输入框，用户消息立即出现在消息列表中（无需等待服务端确认）
- 消息通过 WebSocket 发送 `session:user_message`，payload：`{ sessionId, text, messageId }`
- 服务端处理后广播 `session:message`（role=user），各 Tab 同步
- 使用乐观消息（messageId 以 `opt_` 前缀）立即显示

## 4.7 模型池配置面板

- Blueprint `Drawer` 组件（从右侧滑出），独立于 MainContent
- 点击 Header 的模型池配置按钮打开

### 配置表格

| Provider | Model ID | Role | Thinking Level | In Use | Actions |
|----------|----------|------|----------------|--------|---------|
| anthropic | claude-3-5-sonnet | worker | medium | [icon:tick] | [icon:edit] [icon:delete] |
| anthropic | claude-3-5-haiku | reviewer | — | [icon:cross] | [icon:edit] [icon:delete] |

### 操作
- **添加**：`Select` 选择 provider，`InputGroup` 输入 modelId，`Select` 选 role，`Select` 选 thinkingLevel → 添加按钮
- **编辑**：点击编辑图标 → 行内编辑 `thinkingLevel` → 保存/取消
- **删除**：点击删除图标 → Blueprint `Alert` 确认对话框
- 实时生效：每次操作发送 `model_pool:update` → 服务端更新 `.omp/models.toml` 文件 → 广播 `model_pool:changed` → 所有已连接浏览器同步

## 4.8 深色模式

- 自动跟随系统主题：`matchMedia('(prefers-color-scheme: dark)')`
- 在 root DOM 节点添加 Blueprint `Classes.DARK` class
- 所有组件继承 Blueprint 原生暗色主题，无需额外样式
- 监听 `change` 事件，用户切换系统主题时自动跟随

## 4.9 移动端适配
- 最佳努力（best effort）支持，不单独开发移动端 UI
- 利用 Blueprint 原生响应式能力：`Drawer` 自动全屏、表格横向滚动
- 实际代码中**未实现汉堡菜单**——Sidebar 在移动端保持展示
- 不写移动端专用 CSS 或组件，所有适配逻辑共用同一套源码

## 4.10 安全

- HTTP + WebSocket 服务器默认绑定 `127.0.0.1`（仅本地可访问），不暴露到局域网
- 如需远程访问，通过 SSH 端口转发，不在网络层开放
- 不实现身份认证——绑定 localhost 已满足单用户场景安全性
