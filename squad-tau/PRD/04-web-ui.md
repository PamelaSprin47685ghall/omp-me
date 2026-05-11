# Squad-Tau PRD — 04 Web UI 实时镜像

### 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | React | 18.3.x |
| UI 组件 | @blueprintjs/core | 6.12.x |
| 图标 | @blueprintjs/icons | 6.9.x |
| DAG 可视化 | mermaid | 11.14.x |
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

### Sessions Tree（双层标准树）
- Blueprint `Tree` 组件，最多 2 层：节点 → 执行阶段
- **增量更新**：直接操作 Blueprint Tree 实例的节点增/删/改方法，不重新设 contents
- **排序规则**：两层均按 session 创建时间升序排列（自然数 session ID 递增即创建时间升序）
  - 第一层（Node）：节点按其第一个 session 的创建时间升序排列
  - 第二层（Phase）：子节点按每个 phase session 的创建时间升序排列
- 结构：双层树，第一层 Node（状态图标 + 节点 ID），第二层 Phase（`R<retry>-<role>` + 状态图标）。示例：feature-x 节点下有 R1-Worker、R1-Reviewer、R2-Worker 三个 phase。
- 第一层（Node）：显示节点 ID + 状态图标（与之前一致）
- 第二层（Phase）：`R<retry>-<role>` + 阶段状态图标
  - 角色缩写：Worker, Reviewer, OuterReview
  - 每个第二层节点可点击，点击切换到该阶段的会话视图
  - 第二层节点增量更新：新阶段启动时追加到末尾（session 创建时间自然升序）
- 所有图标使用 Blueprint `Icon` 组件 + `@blueprintjs/icons` 的 `IconNames` 枚举
- 实际挑选图标时查阅 https://blueprintjs.com/docs/#icons/icons-list，选择最贴合语义的图标，不将就
- 各状态图标意图：
  - approved → 表示成功/完成
  - rejected → 表示错误/否定
  - pending → 表示等待/时钟
  - authoring/confirming/reviewing → 表示进行中/刷新
  - failed/blocked → 表示禁止/错误
  - outer review → 表示总览/审核

### 自动切换逻辑
1. 新会话启动 → 自动切换到该会话
2. 用户手动点击 → 切换到该会话，锁定（不再自动切换）
3. 锁定时侧边栏显示小锁图标，点击可解锁恢复自动切换
4. **多 Tab 互不影响**：每个浏览器 Tab 独立管理自己的锁定状态和自动切换

## 4.5 Header

- **左侧**：`Squad-Tau` 品牌标识 + 切换 DAG 面板折叠的按钮（使用折叠/展开图标）
- **中间**：连接状态指示器，使用 Blueprint `Icon` 组件，绿色表示已连接，红色表示断连；hover 显示详情
- **右侧**：模型池配置按钮（用设置/齿轮图标）+ Abort 按钮（用停止/关闭图标，仅在 squad 活跃时显示，点击不可逆）
- **深色**：跟随系统 `prefers-color-scheme`，应用 Blueprint `Classes.DARK`
- **响应式**：1280px 以下品牌标识隐藏，只保留图标按钮

## 4.6 主内容区（MainContent）

### DAG View（主内容区顶部）
- DAG（Mermaid）放在主内容区顶部，作为可折叠面板
- 默认展开，用户可点击 Header 的 DAG 视图切换按钮折叠收起
- 宽度占满主内容区，不受侧栏窄宽度限制
- 点击 DAG 节点 → 跳转到对应 worker/reviewer 会话
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
  - **最新工具调用默认展开**，旧的自动折叠
  - 显示 tool 名称、参数（JSON 格式化）、结果
  - 结果可点击展开/折叠
  - 工具调用期间显示加载动画（`Spinner`）
  - 错误结果自动展开并以红色高亮

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
- 当 squad 整体失败（所有节点 blocked/failed）时，主内容区顶部显示全宽错误 banner
- 使用 Blueprint `Callout` 组件，`intent="danger"`，标题 `Squad Failed`
- banner 显示失败原因和 blocked/failed 节点数量
- 用户可手动关闭 banner（`dismissible`）
- 其他错误（WebSocket 断连、服务端崩溃）通过 Header 连接状态指示器展示

### 消息输入

当前查看的 session 处于活跃状态时，消息列表底部显示输入区域。

- Blueprint `TextArea`（支持多行）+ `Button`（发送），支持 Enter 发送，Shift+Enter 换行
- 输入框占满宽度，发送按钮固定在右侧
- 发送后清空输入框，用户消息立即出现在消息列表中（无需等待服务端确认）
- 消息通过 WebSocket 发送 `session:user_message`，payload：`{ sessionId, text }`
- 服务端处理后广播 `session:message`（role=user），各 Tab 同步
- 当 session 处于结束状态（`completed` / `aborted` / `failed`），输入框禁用并显示占位提示

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
- 利用 Blueprint 原生响应式能力：`Drawer` 自动全屏、表格横向滚动、Sidebar 折叠为汉堡菜单
- 不写移动端专用 CSS 或组件，所有适配逻辑共用同一套源码

## 4.10 安全

- HTTP + WebSocket 服务器默认绑定 `127.0.0.1`（仅本地可访问），不暴露到局域网
- 如需远程访问，通过 SSH 端口转发，不在网络层开放
- 不实现身份认证——绑定 localhost 已满足单用户场景安全性
