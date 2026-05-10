# REF-04: OMP 扩展 API 参考

> 全局安装路径：`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/`
> Shim 包路径：`../shim-packages/`

## 核心文件

### `extensibility/extensions/types.ts`

定义 ExtensionAPI 接口（~1379 行），是插件开发的核心类型。

| 类型/接口 | 用途 |
|-----------|------|
| `ExtensionAPI` | 传递给插件工厂函数的完整 API |
| `ExtensionContext` | 事件处理器的上下文参数 |
| `ExtensionCommandContext` | 命令处理器的扩展上下文 |
| `ExtensionEvent` | 所有事件类型的联合 |
| `ToolDefinition` | `registerTool()` 的工具定义 |

### ExtensionAPI 关键方法

| 方法 | 用途 |
|------|------|
| `pi.on(event, handler)` | 订阅 agent 生命周期事件 |
| `pi.registerCommand(name, opts)` | 注册 `/command` |
| `pi.registerTool(name, def)` | 注册 LLM 可调用工具 |
| `pi.sendUserMessage(content, opts?)` | 向当前 session 注入用户消息，`opts.deliverAs`: `"steer"` / `"followUp"` |
| `pi.sendMessage(message, opts?)` | 发送自定义消息（可设置 `deliverAs: "nextTurn"`） |
| `pi.setStatus(key, value)` | 设置插件状态（如 `setStatus('mirror', port)`） |
| `pi.getSessionName()` | 获取当前 session 名称 |
| `pi.setSessionName(name)` | 设置 session 名称 |
| `pi.getThinkingLevel()` | 获取 thinking 级别 |
| `pi.setThinkingLevel(level)` | 设置 thinking 级别 |
| `pi.setModel(model)` | 设置模型 |
| `pi.getActiveTools()` | 获取活跃工具列表 |
| `pi.setActiveTools(names)` | 设置活跃工具 |

### ExtensionContext 关键属性

| 属性 | 用途 |
|------|------|
| `ctx.model` | 当前模型信息 |
| `ctx.sessionManager` | `SessionManager` 实例 |
| `ctx.abort()` | 中止当前生成 |
| `ctx.isIdle()` | 是否空闲（无正在进行的 LLM 调用） |
| `ctx.getContextUsage()` | 上下文用量 |

### SessionManager API

> `session/session-manager.ts`（~95.7KB）

| 方法 | 用途 |
|------|------|
| `createAgentSession(opts)` | 创建子 session（squad worker/reviewer 使用） |
| `getEntries()` | 获取所有消息条目 |
| `getSessionFile()` | 获取 session JSONL 文件路径 |

### 事件类型

| 事件 | 负载 | 触发时机 |
|------|------|---------|
| `session_start` | `{ type: "session_start" }` | 会话加载 |
| `agent_start` | `{ type: "agent_start" }` | agent 循环开始 |
| `agent_end` | — | agent 循环结束 |
| `turn_start` | — | 轮次开始 |
| `turn_end` | — | 轮次结束 |
| `message_start` | `{ message }` | 消息开始 |
| `message_update` | `{ delta }` | 流式文本更新 |
| `message_end` | `{ message }` | 消息结束 |
| `tool_execution_start` | `{ toolName, input, toolId }` | 工具调用开始 |
| `tool_execution_update` | `{ toolId, output }` | 工具执行更新 |
| `tool_execution_end` | `{ toolId, result }` | 工具执行结束 |
| `before_agent_start` | — | 用户提交 prompt 后、agent 启动前 |
| `auto_compaction_start` | — | 自动压缩开始 |
| `auto_compaction_end` | — | 自动压缩结束 |

### `session/session-manager.ts`

| API | 用途 |
|-----|------|
| `SessionManager` | 管理 session 生命周期 |
| `createAgentSession(options)` | 创建子代理 session（返回 `{ session, dispose }`） |
| `subscribe(callback)` | 订阅 session 事件（message, tool_call, tool_result, thinking_delta） |

### `session/agent-session.ts`

| API | 用途 |
|-----|------|
| `AgentSession` | 完整的 agent 会话实现（~257KB） |
| `.prompt(text)` | 发送 prompt 并等待响应 |

### `sdk.ts`

| API | 用途 |
|-----|------|
| SDK 程序化使用接口 | 用于在非交互环境中使用 pi-coding-agent |

## Shim 包

### `shim-packages/pi-coding-agent/index.js`

从全局安装重新导出特定 API：
- `DynamicBorder` — TUI 动态边框组件
- `convertToLlm` — 消息格式转换

### `shim-packages/pi-shim/index.js`

| API | 用途 |
|-----|------|
| `loadPlugin(importMetaUrl)` | 加载插件（相对于 shim.mjs 位置解析 index.js） |
| `resolvePluginPath(importMetaUrl)` | 解析插件路径 |

### `shim-packages/pi-resolve/index.js`

| API | 用途 |
|-----|------|
| `getPiBase()` | 获取 oh-my-pi 全局安装基路径：`~/.bun/install/global/node_modules/@oh-my-pi` |
