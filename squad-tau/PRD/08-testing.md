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

## 8.2 单元测试（Bun Test，每个测试文件 ≤200 行）

因代码库按 ≤200 行/文件拆分，测试文件也按模块拆分，每个测试文件覆盖一个源文件。

### 状态机 (`state-machine.test.js`)
- 每个状态 × 每个事件的转换结果
- `emptyState(true)` → `waiting_deps`
- `emptyState(false)` → `pending`
- 重试计数递增
- MAX_RETRIES 边界（虽然 = Infinity，但测试有限轮次）
- 非法状态转换拒绝

### Squad FSM (`squad-fsm.test.js`)
- idle → active → revising 转换
- active 时禁止再次 submit_plan
- revising → active（重投）
- idle 时 submit_plan 拒绝

### DAG 拓扑排序 (`dag-sort.test.js`)
- 无依赖 → 单层
- 链式依赖 → 多层
- 菱形依赖 → 正确分层
- 循环依赖 → 抛出错误

### DAG 验证 (`dag-validate.test.js`)
- `validateNodes`：重复 ID
- `validateNodes`：引用未知节点
- `validateNodes`：空节点列表
- `validateNodes`：无效模式

### DAG 执行 (`dag-execute.test.js`)
- 完整 DAG 编排流程
- 事件触发顺序
- 结果收集

### DAG 并发 (`dag-concurrency.test.js`)
- `executeLayer`：节点失败 → 下游 blocked
- 并发限制正确
- 信号中止传播

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

### 文件篡改检测 (`tamper-detection.test.js`)
- `captureFileSnapshots` / `filesChanged`：mtime 检测
- 无变化时不报告
- 文件删除时报告
- 文件创建时报告

### 空轮次保护 (`empty-turns.test.js`)
- MAX_EMPTY_TURNS 常量正确
- 空轮次计数器递增
- 达到上限时强制错误

### Worker 执行 (`run-worker.test.js`)
- `buildWorkerPrompt`：包含上游结果
- `buildWorkerPrompt`：重试时包含 reviewer 反馈
- `runWorker` 创建 session 并注入工具
- 模型分配逻辑

### Confirm 执行 (`run-confirm.test.js`)
- `buildConfirmPrompt`：包含原始任务，不包含 worker summary
- `runConfirmSession` 复用 worker session
- `confirm` / `return_work` 工具注入
- 文件篡改检测集成

### Reviewer 执行 (`run-reviewer.test.js`)
- `buildReviewerPrompt`：包含 review_criteria
- `runReviewer` 创建只读 session
- `approve` / `reject` 工具注入
- 只读约束（无写工具）

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

#### RPC 协议

OMP RPC 使用 JSON 行协议（JSONL），每条消息独立一行。命令通过 `type` 字段标识，响应和事件通过 stdout 输出。

```
# ← stdout: 启动后立即发送
{"type":"ready"}
# 后续跟随 extension/ui 事件...

# → stdin: 发送命令（需提供 id 用于关联响应）
{"id":"1","type":"get_state"}
{"id":"2","type":"get_available_models"}

# ← stdout: 对应响应
{"id":"1","type":"response","command":"get_state","success":true,"data":{...}}
{"id":"2","type":"response","command":"get_available_models","success":true,"data":{"models":[...]}}

# ← stdout: 异步事件（无 id）
{"type":"agent_start","sessionId":"..."}
{"type":"message_delta","sessionId":"...","delta":{"type":"thinking_delta","text":"..."}}
```

**所有命令列表**（来自 `src/modes/rpc/rpc-types.ts`）：

| type | 用途 |
|------|------|
| `prompt` | 发送提示词（异步，后续跟随事件流） |
| `steer` | 中断当前运行并发送新消息 |
| `follow_up` | 排队发送消息（当前运行结束后执行） |
| `abort` | 中止当前运行 |
| `abort_and_prompt` | 中止 + 发送新消息 |
| `new_session` | 创建新会话 |
| `get_state` | 获取当前会话状态 |
| `get_available_models` | 列出可用模型 |
| `set_model` | 切换模型 |
| `bash` | 执行 bash 命令并返回结果 |
| `set_host_tools` | 注册 host 端工具（供插件使用） |
| `get_messages` | 获取会话消息历史 |

#### 交互式测试工作流（tmux）

手动测试时，用 tmux 让 OMP 进程常驻后台，逐步交互：

```bash
# 1. 启动常驻进程
tmux new-session -d -s omp-rpc 'omp --mode rpc 2>&1'

# 2. 等待 ready
sleep 2
tmux capture-pane -t omp-rpc -p | head -5
# 应看到: {"type":"ready"}

# 3. 发送命令
tmux send-keys -t omp-rpc '{"id":"1","type":"get_state"}' Enter

# 4. 读取响应
sleep 1
tmux capture-pane -t omp-rpc -p | tail -10

# 5. 发送 squad 任务（extension 注册了 /squad 命令后）
tmux send-keys -t omp-rpc '{"id":"2","type":"prompt","message":"/squad M Write a sorting function"}' Enter

# 6. 逐步读取事件流
sleep 5
tmux capture-pane -t omp-rpc -p | grep -o '"type":"[^"]*"' | sort -u

# 7. 结束测试
tmux kill-session -t omp-rpc
```

#### 自动化测试驱动（tmux + Bun）

OMP 进程由 tmux 托管，Bun 测试脚本通过 tmux CLI 发送命令和读取输出。Bun 负责 JSON 解析和断言。

```javascript
// helpers/rpc-tmux.js — tmux 驱动的 RPC 客户端
import { $ } from 'bun';

const SESSION = 'omp-rpc';

export async function setupRpc() {
  await $`tmux new-session -d -s ${SESSION} 'omp --mode rpc 2>&1'`;
  // 轮询直到收到 ready
  for (let i = 0; i < 20; i++) {
    const out = await $`tmux capture-pane -t ${SESSION} -p`.text();
    if (out.includes('"type":"ready"')) return;
    await Bun.sleep(500);
  }
  throw new Error('RPC did not become ready');
}

export async function rpcSend(json) {
  await $`tmux send-keys -t ${SESSION} ${json} Enter`;
}

export async function rpcRead() {
  return await $`tmux capture-pane -t ${SESSION} -p`.text();
}

export async function waitForResponse(timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await rpcRead();
    // 从末尾向前找最后一条 response JSON
    const lines = text.split('\n').filter(l => l.startsWith('{'));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'response') return obj;
      } catch {}
    }
    await Bun.sleep(200);
  }
  throw new Error('Timeout waiting for RPC response');
}

export async function teardownRpc() {
  await $`tmux kill-session -t ${SESSION}`.nothrow();
}
```

#### 测试用例设计

**`rpc-e2e.test.js`**（Bun test）：

| 用例 | 步骤 | 验证点 |
|------|------|--------|
| 基础连接 | `setupRpc()` | ✓ 不抛异常 |
| 获取状态 | `rpcSend(get_state)` → `waitForResponse()` | ✓ `command === "get_state"`<br>✓ `success === true`<br>✓ `data.sessionId` 存在 |
| M 模式完整流程 | `rpcSend(prompt /squad M ...)` | ✓ 事件流包含 `agent_start`/`message_delta`/`agent_end` |
| L 模式菱形依赖 | `rpcSend(prompt /squad L ...)` | ✓ 事件序列正确 |
| bash 命令 | `rpcSend(bash)` | ✓ `BashResult` 含 stdout/exitCode |
| 异常命令 | `rpcSend(畸形JSON)`<br>`rpcSend(未知 type)` | ✓ 进程不崩溃 |

```javascript
// rpc-e2e.test.js
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupRpc, rpcSend, waitForResponse, teardownRpc } from './helpers/rpc-tmux.js';

beforeAll(setupRpc);
afterAll(teardownRpc);

test('get_state returns session state', async () => {
  await rpcSend(JSON.stringify({ id: '1', type: 'get_state' }));
  const resp = await waitForResponse();
  expect(resp.success).toBe(true);
  expect(resp.data.sessionId).toBeDefined();
});

test('get_available_models returns model list', async () => {
  await rpcSend(JSON.stringify({ id: '2', type: 'get_available_models' }));
  const resp = await waitForResponse();
  expect(resp.success).toBe(true);
  expect(resp.data.models.length).toBeGreaterThan(0);
});
```

### 8.4.4 断言共享

所有测试共享的断言逻辑抽取到 `helpers/`：

| 文件 | 用途 |
|------|------|
| `puppeteer-setup.js` | 启动/关闭 Puppeteer 浏览器，连接 WebSocket |
| `mock-pi.js` | Mock pi API + 模拟事件流 |
| `rpc-tmux.js` | tmux 驱动的 RPC 客户端（setup/send/read/teardown） |
| `assertions.js` | 共享断言（等待 UI 元素、验证状态图标、RPC 响应匹配） |

## 8.5 Chaos 测试（疯猴子测试）

Chaos 测试位于测试金字塔最顶层。不使用 `--mode rpc` 的结构化协议，而是直接启动纯 `$ omp` 交互模式（TUI），通过 tmux 注入随机键盘事件，模拟真实用户的混乱操作。

目标：验证 OMP + squad-tau 在非理想条件下的鲁棒性——不崩溃、不死锁、不丢数据。

### 8.5.1 驱动方式

tmux 可以直接发送特殊键（Ctrl+C、Escape 等），模拟用户在 TUI 中的任意操作：

```bash
# 启动原生交互模式
tmux new-session -d -s omp-chaos 'omp 2>&1'
sleep 2

# 发送文本 + 回车
tmux send-keys -t omp-chaos '/squad M Write a sorting function' Enter

# 发送 Ctrl+C 中断
tmux send-keys -t omp-chaos C-c

# 发送 Escape
tmux send-keys -t omp-chaos Escape

# 读取屏幕内容
out=$(tmux capture-pane -t omp-chaos -p)
echo "$out"

# 清理
tmux kill-session -t omp-chaos
```

### 8.5.2 实现思路

驱动层只需提供最底层原语（tmux + Puppeteer），混沌逻辑本身由实现者自行创造：

| 原语 | 说明 |
|------|------|
| `setup()` | `tmux new-session -d` 启动 `$ omp` |
| `type(text)` | `tmux send-keys` 发送文本 |
| `press(key)` | `tmux send-keys` 发送特殊键（C-c, Escape 等） |
| `screenshot()` | `tmux capture-pane` 读取屏幕内容 |
| `isAlive()` | `tmux has-session` 检查进程 |
| `browserGoto(url)` | Puppeteer 导航到 squad-tau Web UI |
| `browserObserve()` | Puppeteer 截图 / 检查 DOM / 检查 WS 状态 |
| `teardown()` | `tmux kill-session` + `browser.close()` |

基于这些原语，实现者自由组合 attack vectors。feel free 根据自己的想象力添加更多原语（如输入 steer、刷新浏览器、在浏览器中点击不同功能等），不局限于上述列表。下面给出攻击面指南，具体实现不限形式。

### 8.5.3 攻击面指南

实现者应对以下所有路径设计随机破坏性场景：

#### 命令路径

| 攻击面 | 思路示例 |
|--------|----------|
| `/squad M` 滥用 | 极短文本、极长文本、特殊字符、Unicode、仅空格、仅路径 |
| `/squad L` 滥用 | 空节点列表、循环依赖、海量节点（50+）、同名节点 |
| `/squad --help` | 任何运行阶段可执行且不产生副作用 |
| 快速混合模式 | 1s 内轮替 `/squad M` / `/squad L` / `/squad` |
| `/new` 风暴 | squad 执行中反复 `/new`，验证 session 切换不泄漏资源 |
| `/compact` 滥用 | squad 执行中执行压缩、空 session 压缩、压缩后立即 C-c |

#### 用户交互路径

| 攻击面 | 思路示例 |
|--------|----------|
| Squad 运行时 steer | 发起 squad 后随机延时输入自然语言消息（模拟 Web UI 用户消息） |
| 矛盾 steer | "do X" → 等 1s → "actually do Y" → 等 1s → "ignore that, do Z" |
| 垃圾输入 | 随机 ASCII、二进制控制字符、超长无意义重复文本 |
| 空输入 | 直接 Enter、仅空格 Enter |
| 混合语言 | 中文/日文/阿拉伯文混杂、emoji 溢出 |

#### 中断路径

| 攻击面 | 思路示例 |
|--------|----------|
| Ctrl+C 连发 | 不同频率（10ms~500ms 间隔）、不同时机（squad 启动瞬间 / thinking 中 / tool 执行中） |
| Escape 滥用 | 各种菜单/弹窗可见时按 Escape |
| Ctrl+Z (SIGTSTP) | 挂起进程后 resume，验证状态完整 |
| 混合中断 | Ctrl+C → 立即输入 → Escape → 立即 `/new` |

#### 浏览器观察路径

| 攻击面 | 思路示例 |
|--------|----------|
| 运行时刷新 | squad 执行中各阶段刷新浏览器，验证 WS 重连和状态同步 |
| 多 Tab | 多个浏览器 Tab 同时打开，验证事件广播一致性 |
| 长时观察 | 保持浏览器打开一整轮 chaos run，验证无内存泄漏 |
| 浏览器关闭/重开 | 关闭浏览器 → 继续 chaos → 重新打开浏览器，验证恢复 |
| 模型池面板操作 | 浏览器中增删改模型池槽位，同时 TUI 中执行 squad |
| DAG 图验证 | L 模式执行中刷新页面，验证 Mermaid DAG 渲染正确 |

#### 并发路径

| 攻击面 | 思路示例 |
|--------|----------|
| TUI 打字 + 浏览器同时操作 | tmux 持续输入文字的同时 Puppeteer 操作模型池面板 |
| 多个 squad 进程 | 不等前一个结束就启动新的 `/squad` |
| 快速 session 切换 | `/new` → 立即 `/squad` → 不等完成 → `/new` → 立即 C-c |
| 资源耗尽 | 连续创建几十个 session 不清理 |

#### 破坏性/功能性场景

混沌测试不只是乱按，还应验证关键功能在干扰下仍正确工作。feel free 增加更多破坏性/功能性场景：

| 攻击面 | 思路示例 |
|--------|----------|
| 先 chaos 后验证 | 疯狂中断 30s → 发起一个正常的 `/squad M` → 验证产出完整 |
| 浏览器观察不影响功能 | 浏览器反复刷新/操作面板的同时发起 squad，验证 squad 结果正确 |
| 混乱中切 session | `/squad` 执行中 → 浏览器观察 → `/new` → 新 session 发起新 squad → 验证两个 session 互不污染 |
| steer 后检查结果 | squad 运行时输入 steer → 等待完成 → 验证 steer 内容反映在最终输出中 |
| 浏览器 UI 与 TUI 一致 | 发起 squad → 浏览器截图 → tmux 截图 → 对比两者显示的 session 状态吻合 |
| 模型池修改生效 | 浏览器删除所有 reviewer 槽位 → 发起 L 模式 → 验证自动降级到当前会话模型（不回退到空池） |
| 恢复能力 | 连续 5 次 Ctrl+C 中断 squad → 发起第 6 次 → 验证能正常完成 |

### 8.5.4 验证标准

混沌测试结束后验证：

1. **进程存活**：`tmux has-session` 成功，OMP 未 segfault/崩溃
2. **TUI 可交互**：能正常输入并看到响应，不死屏
3. **浏览器可访问**：squad-tau 页面正常加载，非空白/非崩溃
4. **WS 可连接**：浏览器 WebSocket 状态为 connected
5. **Session 可工作**：可正常发起 `/squad` 并产生输出
6. **无文件泄漏**：session 目录下无残留异常文件

### 8.5.5 交付物

| 文件 | 用途 |
|------|------|
| `chaos-e2e.test.js` | 混沌测试实现（具体场景由实现者自主设计） |


