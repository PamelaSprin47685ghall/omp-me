# REF-01: Tau-Mirror 原生包核心参考

> 路径：`../node_modules/tau-mirror/`

## `extensions/mirror-server.ts`

tau-mirror 的服务端核心。实现 HTTP + WebSocket 服务器，接收浏览器连接，处理用户消息路由。

| 关注点 | 用途 |
|--------|------|
| `default export` | 工厂函数 `(pi: ExtensionAPI) => void`，注册事件监听和命令处理 |
| `handleCommand()` | 处理浏览器发来的命令（prompt/steer/follow_up/abort/get_state 等） |
| `pi.sendUserMessage()` | 向 agent 会话注入用户消息，支持 `{ deliverAs: "steer" }` 参数 |
| `broadcast()` | 向所有连接浏览器广播 `{ type: "event", event: ... }` |
| `buildStateSnapshot()` | 构建 `mirror_sync` 状态快照（entries, model, thinkingLevel, isStreaming 等） |

## `public/websocket-client.js`

浏览器端 WebSocket 客户端，继承 `EventTarget`。

| API | 用途 |
|-----|------|
| `new WebSocketClient(url)` | 连接到 `ws://host/ws` |
| `.connect()` / `.reconnect()` | 建立/断开连接（指数退避重连） |
| `.send(data)` | 发送 JSON 消息 |
| `.request(cmd)` | 请求-响应模式 |
| 事件 `connected/disconnected/reconnectFailed` | 连接状态 |
| 事件 `rpcEvent` | 收到 `{ type: "event", event: ... }` |
| 事件 `mirrorSync` | 收到 `mirror_sync` 完整状态快照 |

## `public/state.js`

| API | 用途 |
|-----|------|
| `StateManager` | 管理会话状态（messages, model, thinkingLevel） |

## `public/app.js`

主应用，包含完整的前端交互逻辑。

| 区域 | 关键代码 |
|------|---------|
| 消息发送 | `chatForm.onsubmit` → 读取 input → `wsClient.send({ type: "prompt", message, images })` |
| 事件驱动 | `handleRPCEvent()` 分发 `message_start/update/end`、`tool_execution_start/update/end` |
| 输入框 | Enter 发送、Shift+Enter 换行、自动缩放、图片粘贴/拖放/base64 |
| 自动滚动 | `scrollBottomBtn`、`isScrolledUp` 检测 |
| 模型选择 | `model-dropdown`、`thinking-btn` 循环 thinking level |
| 侧边栏 | `toggleSidebar()`、session 搜索 |
| Mirror 模式 | `handleMirrorSync()` — 从 TUI 接收完整状态快照渲染 |

## `public/message-renderer.js`

| API | 用途 |
|-----|------|
| `MessageRenderer` | 消息渲染（角色区分、流式文本、Markdown、thinking 块） |

## `public/session-sidebar.js`

| API | 用途 |
|-----|------|
| `SessionSidebar` | 会话列表加载、搜索、活跃标记 |

## `public/tool-card.js`

| API | 用途 |
|-----|------|
| `ToolCardRenderer` | 工具调用卡片渲染、状态更新、折叠控制 |

## `public/` 其他文件

| 文件 | 用途 |
|------|------|
| `index.html` | SPA 入口 |
| `dialogs.js` | 对话框/命令面板 |
| `file-browser.js` | 文件浏览侧边栏 |
| `markdown.js` | Markdown 渲染 |
| `themes.js` | 主题切换 |
| `style.css` | 样式表（73KB） |
| `sw.js` | PWA Service Worker |
