# Squad-Tau PRD — 05 事件协议

## 核心公理

1. **EventLog 是不可变事实日志**。只能追加，不能删除或修改已有条目。每次 `append()` 产生一个单调递增的 `id`。
2. **CMD (Command) 是内存中的意图**。`CMD_*` 事件由 Reactor 推导产生，存在于 Engine Pulse 生命周期内，不入 EventLog。引擎执行 CMD 时同步插入 "过渡态事实" 防止无限推导。
3. **流式事件不入日志**。`session:message_delta` 和 `session:thinking_delta` 仅广播到 WebSocket 客户端，不入 EventLog 永久存储。
4. **WebSocket 事件格式与 EventLog 条目一致**。所有持久化事件通过 WebSocket 广播时包含 `seq` 字段（对应 EventLog `id`），客户端可通过 `sync` 请求按水位线补齐。

## 5.1 事实分类

| 类别 | 特征 | 示例 | 存储 |
|------|------|------|------|
| **持久事实 (Fact)** | 不可变，永远追加 | `squad:node_state`、`session:start` | EventLog（永存） |
| **过渡态事实 (Transition)** | 防止 Reactor 重复推导 | `session:creating`、`session:prompting` | EventLog（可由 Reactor 检查） |
| **意图 (Command)** | Reactor 推导出的下一步动作 | `cmd:create_session`、`cmd:prompt` | 仅内存，Engine Pulse 生命周期 |
| **流式广播 (Stream)** | 高频瞬态数据 | `session:message_delta`、`session:thinking_delta` | 仅 WebSocket 广播 |

## 5.2 过渡态保护机制

为了防止 Reactor 在 CMD 执行期间反复推导同一个动作（无限循环），引擎在接收 CMD 的同时向 EventLog 追加过渡态事实。Reactor 检测到过渡态后，不会重新推导该动作。

| CMD | 过渡态事实 | 目的 |
|-----|-----------|------|
| `cmd:create_session` | `session:creating {nodeId, phase}` | 防止重复创建 session |
| `cmd:prompt` | `session:prompting {sessionId, phase}` | 防止重复发送 prompt |

## 5.3 WebSocket 连接

- 端点：`ws://127.0.0.1:<port>/ws`
- 初始连接后服务端立即发送完整的 EventLog 回放（所有持久事件），客户端通过 `sync` 请求后续增量

## 5.4 消息格式

```javascript
// WebSocket 消息结构
{
  type: string,       // 事件类型
  payload: unknown,   // 事件数据
  timestamp: number,  // Unix 毫秒时间戳
  seq?: number        // EventLog id（仅持久事实有此字段）
}
```

**序列保证**：单条 WebSocket 连接天然保证消息顺序，无需序列号、ack 或重传机制。

## 5.5 客户端同步协议

```javascript
// 浏览器 → 服务端：请求从指定水位线补齐事件
{ type: 'sync', payload: { cursor: number } }

// 服务端 → 浏览器：返回从 cursor 开始的所有事件（每个包含 seq 字段）
// 通过 onConnection 回调在连接时自动发送全量，sync 用于重连后补齐
```

客户端在 WebSocket 连接时收到全量 EventLog 回放。后续通过 `sync` 补齐断线期间遗漏的事件。

## 5.6 连接事件

```javascript
// 服务端 → 浏览器：连接建立（同时触发全量 EventLog 回放）
{ type: 'connection:established', payload: { sessionId: number, serverVersion: '1.0.0' } }

// 服务端 → 浏览器：连接断开（优雅通知）
{ type: 'connection:close', payload: { reason: 'server_stop' } }

// 浏览器 → 服务端：ping（心跳）
{ type: 'ping' }

// 服务端 → 浏览器：pong
{ type: 'pong' }

// 浏览器 → 服务端：abort（中止 squad）
{ type: 'abort', payload: {} }
```

## 5.7 Squad 状态事实

```javascript
// squad:init — Squad 启动，写入 DAG 定义
{ type: 'squad:init',
  payload: {
    mode: 'M' | 'L',
    nodes: Array<{
      id: string,
      task: string,
      review_criteria: string | string[],
      depends_on?: string[]
    }>,
    originalTask: string
  }
}

// squad:node_state — 节点状态变更（由 Reactor 推导后追加）
{ type: 'squad:node_state',
  payload: {
    nodeId: string,
    status: 'idle' | 'authoring' | 'confirming' | 'reviewing'
           | 'approved' | 'rejected' | 'blocked' | 'failed',
    retryCount: number,
    summary?: string,
    affectedFiles?: string[],
    error?: string,         // 仅 failed 状态时携带错误信息
    timestamp?: number      // 可选时间戳
  }
}

// squad:complete — Squad 完成
{ type: 'squad:complete',
  payload: {
    results: Array<{
      id: string,
      status: string,
      summary: string,
      affectedFiles: string[]
    }>,
    durationMs: number
  }
}

// squad:outer_review_start — 外层 review 启动
{ type: 'squad:outer_review_start',
  payload: { round: number }
}

// squad:outer_review_done — 外层 review 批准
{ type: 'squad:outer_review_done', payload: { reason: string } }

// squad:outer_review_failed — 外层 review 驳回
{ type: 'squad:outer_review_failed', payload: { reason: string } }

// squad:abort — Squad 被用户中止
{ type: 'squad:abort', payload: {} }
```

## 5.8 会话事实

```javascript
// session:start — 新会话启动
{ type: 'session:start',
  payload: {
    sessionId: string,
    nodeId?: string,      // 如果是 squad 子会话
    phase: 'worker' | 'reviewer' | 'outer_review' | 'main',
    retryCount?: number,
    model?: { provider: string, id: string }
  }
}

// session:creating — 过渡态事实（session 正在创建中）
{ type: 'session:creating',
  payload: { nodeId: string, phase: string }
}

// session:prompting — 过渡态事实（prompt 已发送）
{ type: 'session:prompting',
  payload: { sessionId: string, phase: string }
}

// session:state — 会话阶段变更
{ type: 'session:state',
  payload: { sessionId: string, phase: string }
}
// 注：在会话结束时与 session:end 成对发送

// session:message — 完整消息（非流式）
{ type: 'session:message',
  payload: {
    sessionId: string,
    role: 'user' | 'assistant',
    content: MessageContent[],
    messageId: string,
    parentId?: string
  }
}

// session:message_delta — 消息增量（流式广播，不入 EventLog）
{ type: 'session:message_delta',
  payload: {
    sessionId: string,
    messageId: string,
    delta: {
      type: 'text_delta' | 'thinking_delta',
      text: string
    }
  }
}

// session:tool_call — 工具调用
{ type: 'session:tool_call',
  payload: {
    sessionId: string,
    toolName: string,
    toolId: string,
    params: unknown
  }
}

// session:tool_result — 工具执行结果
{ type: 'session:tool_result',
  payload: {
    sessionId: string,
    toolId: string,
    result: unknown,
    isError: boolean
  }
}

// session:end — 会话结束
{ type: 'session:end',
  payload: {
    sessionId: string,
    reason: 'completed' | 'aborted' | 'error',
    errorMessage?: string
  }
}
```

## 5.9 模型池事实

```javascript
// model_pool:snapshot — 初始快照（启动时写入）
{ type: 'model_pool:snapshot',
  payload: {
    slots: Array<{
      slotId: string,
      provider: string,
      modelId: string,
      role: 'worker' | 'reviewer',
      thinkingLevel?: string,
      inUse: boolean
    }>
  }
}

// model_pool:acquire — 模型分配事实（Reactor 推导后追加）
{ type: 'model_pool:acquire',
  payload: {
    slotId: string,
    nodeId?: string,
    sessionId?: string,
    role: string
  }
}

// model_pool:release — 模型释放事实（Reactor 推导后追加）
{ type: 'model_pool:release',
  payload: { slotId: string }
}

// model_pool:config_update — 配置变更事实
{ type: 'model_pool:config_update',
  payload: {
    action: 'add' | 'remove' | 'edit',
    slot?: object,
    slotId?: string,
    thinkingLevel?: string
  }
}

// model_pool:changed — 变更后广播到所有浏览器
{ type: 'model_pool:changed',
  payload: {
    slots: Array<{
      slotId: string,
      provider: string,
      modelId: string,
      role: 'worker' | 'reviewer',
      thinkingLevel?: string,
      inUse: boolean
    }>
  }
}
```

## 5.10 用户消息

```javascript
// 浏览器 → 服务端：用户发送消息到指定 session
{ type: 'session:user_message',
  payload: {
    sessionId: string,     // 目标 session ID
    text: string,           // 消息内容
    messageId?: string     // 可选乐观消息 ID（'opt_' 前缀）
  }
}
```

**处理流程**：

1. 服务端收到 → 追加两条事实到 EventLog：
   - `session:message`（role=user，用于 UI 同步）
   - `session:user_message_received`（触发 Engine Pulse 推导）
2. Engine Pulse 检测到新 `session:user_message_received` → 推导 `cmd:user_message`
3. SideEffect 调用 `session.prompt(text)` → 后续事件流（message_delta、tool_call 等）正常广播
4. 如果 session 已结束 → 服务端发送 `{ type: 'error', payload: { message: 'Session not active' } }`

## 5.11 错误事件

```javascript
{ type: 'error',
  payload: { message: string }
}
```

## 5.12 增量渲染策略

- `session:message` 只发送完整消息（如 tool_result、system 消息）
- `session:message_delta` 用于流式文本，浏览器端逐 token 追加到对应 message
- 浏览器端按 `messageId` 归并 delta
- 同一 `messageId` 的 delta 按接收顺序追加（WebSocket 天然有序）
- Thinking delta 和 text delta 可能交错，通过 `type` 区分渲染位置
- Delta 和 Thinking delta 通过 RAF 双缓冲直接写入 DOM，不经过 React State 更新链
