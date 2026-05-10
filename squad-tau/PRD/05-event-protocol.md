# Squad-Tau PRD — 05 事件协议

## 5.1 WebSocket 连接

- 端点：`ws://127.0.0.1:<port>/ws`
- 初始连接后服务端立即发送 `connection:established`

## 5.2 消息格式

```javascript
// WebSocket 消息结构
{
  type: string,       // 事件类型
  payload: unknown,   // 事件数据
  timestamp: number   // Unix 毫秒时间戳
}
```

**序列保证**：单条 WebSocket 连接天然保证消息顺序，无需序列号、ack 或重传机制。

## 5.3 连接事件

```javascript
// 服务端 → 浏览器：连接建立
{ type: 'connection:established', payload: { sessionId: number, serverVersion: string } }

// 服务端 → 浏览器：连接断开（优雅通知）
{ type: 'connection:close', payload: { reason: string } }

// 浏览器 → 服务端：ping（心跳）
{ type: 'ping' }

// 服务端 → 浏览器：pong
{ type: 'pong' }
```

**会话 ID**：使用自然数递增（1, 2, 3, ...），每个新会话分配下一个 ID。

## 5.4 Squad 状态事件

```javascript
// squad:init - Squad 启动，发送 DAG 定义
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

// squad:node_state - 节点状态变更
{ type: 'squad:node_state',
  payload: {
    nodeId: string,
    status: 'waiting_deps' | 'pending' | 'authoring' | 'confirming'
           | 'reviewing' | 'approved' | 'rejected' | 'blocked' | 'failed',
    retryCount: number,
    summary?: string,
    affectedFiles?: string[]
  }
}

// squad:complete - Squad 完成
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

// squad:outer_review_start - 外层 review 启动
{ type: 'squad:outer_review_start',
  payload: { round: number }
}

// squad:outer_review_result - 外层 review 结果
{ type: 'squad:outer_review_result',
  payload: {
    round: number,
    verdict: 'approved' | 'rejected',
    feedback?: string
  }
}

// squad:abort - Squad 被用户中止
{ type: 'squad:abort',
  payload: { reason?: string }
}
```

## 5.5 会话事件

```javascript
// session:start - 新会话启动
{ type: 'session:start',
  payload: {
    sessionId: string,
    nodeId?: string,      // 如果是 squad 子会话
    phase: 'worker' | 'reviewer' | 'outer_review' | 'main',
    retryCount?: number,
    model?: { provider: string, id: string }
  }
}

// session:state - 会话阶段变更
{ type: 'session:state',
  payload: {
    sessionId: string,
    phase: 'authoring' | 'confirming' | 'reviewing' | 'completed' | 'aborted'
  }
}

// session:message - 完整消息（非流式，如 tool_result）
{ type: 'session:message',
  payload: {
    sessionId: string,
    role: 'user' | 'assistant',
    content: MessageContent[],
    messageId: string,
    parentId?: string      // 对应被回复的消息或触发此消息的 tool_call
  }
}

// session:message_delta - 消息增量（流式文本/thinking）
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

// session:tool_call - 工具调用
{ type: 'session:tool_call',
  payload: {
    sessionId: string,
    toolName: string,
    toolId: string,
    params: unknown
  }
}

// session:tool_result - 工具执行结果
{ type: 'session:tool_result',
  payload: {
    sessionId: string,
    toolId: string,
    result: unknown,
    isError: boolean
  }
}

// session:end - 会话结束
{ type: 'session:end',
  payload: {
    sessionId: string,
    reason: 'completed' | 'aborted' | 'error',
    errorMessage?: string
  }
}
```

## 5.6 模型池事件

```javascript
// model_pool:snapshot - 初始连接时发送当前配置
{ type: 'model_pool:snapshot',
  payload: {
    slots: Array<{
      provider: string,
      modelId: string,
      role: 'worker' | 'reviewer',
      thinkingLevel?: string,
      inUse: boolean
    }>
  }
}

// 浏览器 → 服务端：修改模型池
{ type: 'model_pool:update',
  payload: {
    action: 'add' | 'remove' | 'edit',
    slot?: { provider: string, modelId: string, role: string, thinkingLevel?: string },
    index?: number
  }
}

// 服务端 → 所有浏览器：模型池已变更
{ type: 'model_pool:changed',
  payload: {
    slots: Array<{
      provider: string,
      modelId: string,
      role: 'worker' | 'reviewer',
      thinkingLevel?: string,
      inUse: boolean
    }>
  }
}
```

## 5.7 用户消息事件（浏览器 → 服务端）

```javascript
// 浏览器 → 服务端：用户发送消息到指定 session
{ type: 'session:user_message',
  payload: {
    sessionId: string,     // 目标 session ID
    text: string            // 消息内容
  }
}
```

### 服务端处理流程

1. 收到 `session:user_message` → 按 `sessionId` 查找会话实例
2. 若 session 已结束（completed / aborted / failed）→ 回复错误事件 `{ type: 'error', payload: { message: 'Session not active' } }`
3. 若 session 活跃 → 广播 `session:message`（role=user, content=[{ type: 'text', text }]）到所有浏览器客户端，保持多 Tab 同步
4. 调用 `pi.sendUserMessage(sessionId, text)` 将消息注入 agent 会话
5. agent 处理消息后，正常的事件流（`session:message_delta`、`session:message`、`session:tool_call` 等）通过 event-bus → WebSocket 广播，浏览器收到后更新 UI

### 消息确认

服务端不发送单独的 ack 事件。用户消息通过广播的 `session:message`（role=user）隐式确认。如果消息未能投递（session 已结束），服务端发送 `error` 事件。

## 5.8 增量渲染策略

- `session:message` 只发送完整消息（如 tool_result、system 消息）
- `session:message_delta` 用于流式文本，浏览器端逐 token 追加到对应 message
- 浏览器端按 `messageId` 归并 delta
- 同一 `messageId` 的 delta 按接收顺序追加（WebSocket 天然有序）
- Thinking delta 和 text delta 可能交错，通过 `type` 区分渲染位置
- **tool_result**：不额外处理，结果大小受模型上下文窗口限制，不会过大
