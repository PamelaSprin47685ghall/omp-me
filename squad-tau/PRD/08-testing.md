# Squad-Tau PRD — 08 测试策略

## 8.1 测试金字塔

```
        ┌──────────┐
        │  E2E     │  ← Puppeteer 浏览器测试（OMP 内部 + 独立）
        │  (少量)  │
       ┌┴──────────┴┐
       │  Integration│  ← Squad 流程 + WebSocket（mock pi）
       │  (中等)     │
      ┌┴─────────────┴┐
      │  Unit Tests   │  ← 状态机、DAG、模型池、事件总线
      │  (大量)        │
      └───────────────┘
```

## 8.2 单元测试（Bun Test）

### 状态机 (`state-machine.test.js`)
- 每个状态 × 每个事件的转换结果
- `emptyState(true)` → `waiting_deps`
- `emptyState(false)` → `pending`
- 重试计数递增
- MAX_RETRIES 边界（虽然 = Infinity，但测试有限轮次）
- 非法状态转换拒绝

### DAG 执行器 (`dag-executor.test.js`)
- `topologicalSort`：无依赖 → 单层
- `topologicalSort`：链式依赖 → 多层
- `topologicalSort`：菱形依赖 → 正确分层
- `topologicalSort`：循环依赖 → 抛出错误
- `validateNodes`：重复 ID
- `validateNodes`：引用未知节点
- `executeLayer`：节点失败 → 下游 blocked

### 模型池 (`model-pool.test.js`)
- acquire/release 正常配对
- 并发限制：2 个槽位，3 个 acquire 同时等待
- 角色隔离：worker 和 reviewer 独立队列
- signal.abort 取消等待
- 动态添加槽位后等待者立即获取
- 删除使用中的槽位 → pending_delete

### 事件总线 (`event-bus.test.js`)
- 订阅/发布基础
- 通配符订阅 `squad:*`
- 命名空间隔离
- 取消订阅

### 节点执行器 (`node-runner.test.js`)
- `buildWorkerPrompt`：包含上游结果
- `buildWorkerPrompt`：重试时包含 reviewer 反馈
- `buildConfirmPrompt`：包含原始任务，不包含 worker summary
- `buildReviewerPrompt`：包含 review_criteria
- `captureFileSnapshots` / `filesChanged`：mtime 检测

### 8.3 集成测试（Bun Test + Mock）

集成测试按需 mock OMP 框架，不 mock 整个 oh-my-pi 运行时。只 mock `pi` 对象的必要方法（`registerCommand`, `registerTool`, `on`, `createAgentSession`），其余保持真实。

### Mock pi API
```typescript
function stubPi() {
  return {
    registerCommand: () => {},
    registerTool: () => {},
    on: () => () => {},       // returns unsub
    sendMessage: () => {},
    sendUserMessage: () => {},
    setModel: () => {},
    getActiveTools: () => [],
    setActiveTools: () => {},
    getSessionName: () => 'main',
    getThinkingLevel: () => null,
    events: new EventEmitter(),
    pi: {
      createAgentSession: async (opts) => {
        return { session: createMockSession() };
      }
    }
  };
}
```

### Squad 流程 (`squad-flow.test.js`)
- M 模式：从 init → approve 完整流程
- M 模式：reject → retry → approve
- L 模式：2 节点并行
- L 模式：链式依赖
- L 模式：菱形依赖
- L 模式：外层 review reject → revising → 重新 submit_plan
- 文件篡改检测触发
- Abort 信号

### WebSocket 通信 (`websocket.test.js`)
- 启动 HTTP 服务器，浏览器连接 WebSocket
- 发送事件 → 接收事件
- 多客户端同时接收
- 消息格式验证

## 8.4 端到端测试 — Puppeteer + OMP RPC 模式

### 8.4.1 Puppeteer 浏览器测试

### DRY 原则
所有共享逻辑抽取到 `helpers/`：

| 文件 | 用途 |
|------|------|
| `puppeteer-setup.js` | 启动/关闭 Puppeteer 浏览器，连接 WebSocket |
| `mock-pi.js` | Mock pi API + 模拟事件流 |
| `assertions.js` | 共享断言（等待 UI 元素、验证状态图标等） |

### OMP 内部测试 (`browser.test.js`)
直接在 oh-my-pi 进程中测试（开发者自身运行在 OMP 内）。
1. 启动真实 oh-my-pi 进程并加载 squad-tau
2. Puppeteer 打开 `http://127.0.0.1:<port>`
3. 执行 `/squad` 命令
4. 验证浏览器 UI 实时更新：
   - 侧边栏出现会话树
   - DAG 图渲染
   - 消息流实时显示
   - 状态图标正确
5. 清理

### 8.4.2 独立测试 (`standalone.test.js`)
脱离 oh-my-pi 环境独立运行。
1. 启动 mock pi + HTTP 服务器
2. 连接 Puppeteer
3. 模拟事件序列（通过 WebSocket）
4. 验证 UI 渲染
5. 清理

### 8.4.3 OMP RPC 模式端到端测试 (`rpc-e2e.test.js`)

`omp --mode rpc` 是 oh-my-pi 的 JSON-RPC 模式，通过 stdin/stdout 双向 JSON 行协议暴露完整插件控制能力。这是最接近真实运行的测试方式——不 mock pi 对象，不依赖浏览器，直接驱动 OMP 运行时执行 squad-tau。

#### RPC 协议示例

```
# 请求 (→ stdout)
{"id":1,"method":"executeCommand","params":{"command":"/squad","args":["M","Write a sorting function"]}}

# 响应 (← stdin)
{"id":1,"result":{"sessionId":1,"mode":"M","nodes":[...]}}

# 事件推送 (← stdin, 无 id)
{"method":"event","params":{"type":"squad:node_state","payload":{"nodeId":"n1","status":"authoring"}}}
{"method":"event","params":{"type":"session:message_delta","payload":{"sessionId":2,"messageId":"m1","delta":{"type":"thinking_delta","text":"Let me think about..."}}}}
```

#### 测试用例设计

**基础流程** (`rpc-e2e.test.js`)

| 用例 | 步骤 | 验证点 |
|------|------|--------|
| M 模式完整流程 | 1. 启动 `omp --mode rpc` 加载 squad-tau<br>2. 发送 `/squad M Write a sorting function`<br>3. 接收 `squad:init` 事件<br>4. 跟踪 `squad:node_state` 直到 `approved`<br>5. 接收 `squad:complete` | ✓ `squad:init` 包含正确 node<br>✓ 状态转换路径完整<br>✓ 最终 `squad:complete` 含 results<br>✓ 无 error 事件 |
| L 模式菱形依赖 | 1. 启动 RPC 模式
2. 发送 `/squad L ...` 带 3 节点菱形
3. 跟踪所有状态变更 | ✓ DAG 依赖顺序正确<br>✓ 并行节点同时进入 `pending`<br>✓ 下游节点在上游 `approved` 后启动 |
| L 模式外层 review | 1. 启动 RPC 模式
2. 发送调优任务使外层 review 触发
3. 接收 `outer_review_start`<br>4. 模拟 `submit_plan` 工具通过 | ✓ `squad:outer_review_start` 触发<br>✓ `squad:outer_review_result` 送达<br>✓ 状态机进入 `revising` / `approved` |
| 用户消息 steer | 1. 启动 RPC 模式
2. squad 运行中<br>3. 发送 `session:user_message` 事件 | ✓ 消息注入目标 session<br>✓ agent 响应流通过事件返回 |
| 模型池动态调整 | 1. 启动 RPC 模式
2. 发送池配置变更请求<br>3. 启动 squad L 模式 | ✓ 模型池变更生效<br>✓ worker/reviewer 按配置分配 |
| 异常路径 | 1. 启动 RPC 模式
2. 发送畸形参数<br>3. 发送非法命令 | ✓ 错误事件返回<br>✓ 系统不崩溃 |

#### 测试驱动方式

RPC 模式使用子进程通信，测试框架通过 pipe 发送 JSON 请求、读取 JSON 响应和事件。

```javascript
// rpc-e2e.test.js — 结构示意（团队自行完善）
import { spawn } from 'child_process';

function createRpcClient() {
  const proc = spawn('omp', ['--mode', 'rpc'], { ... });
  const lines = [];
  proc.stdout.on('data', chunk => { ... });
  return {
    send: (method, params) => { /* 写入 proc.stdin */ },
    waitForEvent: (type, timeout) => { /* 从 lines 中匹配 */ },
    close: () => proc.kill()
  };
}
```

#### 断言示例

```javascript
// 等待指定类型的事件
async function waitForEvent(client, type, timeout = 30000) {
  // 轮询已收到的事件行，匹配 type
}

// 验证 squad 完成状态
async function assertSquadComplete(client, expectedResults) {
  const event = await waitForEvent(client, 'squad:complete');
  assert.equal(event.payload.results.length, expectedResults);
}
```

### 8.4.4 断言共享

所有测试共享的断言逻辑抽取到 `helpers/`：

| 文件 | 用途 |
|------|------|
| `puppeteer-setup.js` | 启动/关闭 Puppeteer 浏览器，连接 WebSocket |
| `mock-pi.js` | Mock pi API + 模拟事件流 |
| `rpc-client.js` | RPC 客户端封装（启动进程、发送请求、匹配事件） |
| `assertions.js` | 共享断言（等待 UI 元素、验证状态图标、RPC 事件匹配） |
