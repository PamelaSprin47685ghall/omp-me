# Squad-Tau PRD — 08 测试策略

## 8.1 测试金字塔

三层测试：底层大量 Unit Test（状态机/DAG/模型池），中层 Integration Test（mock pi 模拟 squad 流程），顶层少量 E2E（Puppeteer 浏览器 + OMP RPC）。

## 8.2 单元测试（Bun Test，每个测试文件 ≤200 行）

因代码库按 ≤200 行/文件拆分，测试文件也按模块拆分，每个测试文件覆盖一个源文件。

**实际文件数**：42 个单元测试文件（`test/unit/` 目录）+ 5 个集成测试（`test/integration/`）+ 13+ 个 e2e/chaos 测试 + 6 个 helpers + 4 个客户端测试 = 70+ 个测试文件。

### 关键测试覆盖

| 模块 | 测试文件 | 测试重点 |
|------|---------|---------|
| DAG 排序 | `dag-sort.test.js` | Kahn 算法：无依赖/链式/菱形/循环依赖 |
| DAG 验证 | `dag-validate.test.js` | 重复 ID、未知节点依赖、空节点列表 |
| DAG 执行 | `dag-execute.test.js` | 完整编排流程、事件触发顺序 |
| DAG 并发 | `dag-concurrency.test.js` | 节点失败→下游 blocked、并发限制、信号中止 |
| Squad FSM | `squad-fsm.test.js` | idle/active 状态转换 |
| 模型池基础 | `model-pool-basic.test.js` | acquire/release、并发限制、角色隔离 |
| 模型池动态 | `model-pool-dynamic.test.js` | 动态添加槽位、pending_delete |
| 模型池配置 | `model-pool-config.test.js` | 配置读写、文件同步 |
| Worker 执行 | `run-worker.test.js` | 两次 return 调用、提示词构建 |
| Reviewer 执行 | `run-reviewer.test.js` | 每次新 session、return 工具 |
| 事件总线 | `event-bus.test.js` | 订阅/发布、通配符 |
| 审计轮次 | `round2-audit.test.js`, `round3-audit.test.js`, `round4-gaps.test.js` | 多轮审计缺陷修复 |
| 最终 Bug | `final-bugs.test.js`, `bugs-4-7.test.js` | 回归测试 |
| 死代码 | `dead-code.test.js` | 未使用的变量/函数检测 |
| 重复代码 | `duplicate-code.test.js` | 代码重复率检测 |
| Null 安全 | `null-safety.test.js` | 边界情况空值处理 |
| HTTP 服务器 | `http-server.test.js` | 中间件栈、路由 |
| Vite 中间件 | `vite-middleware.test.js` | 惰性加载、跳过逻辑 |
| Session 事件 | `session-events.test.js` | 事件桥接正确性 |
| WS 处理器 | `ws-handler.test.js` | 消息路由、错误处理 |
| WS 心跳 | `ws-heartbeat.test.js` | ping/pong 超时 |
| 客户端测试 | `error-banner.test.js`, `message-input.test.js`, `use-model-pool.test.js`, `sidebar-no-autoswitch.test.js` | React 组件行为 |
| 回归去重 | `regression-dedup.test.js`, `useSessionState-delta.test.js` | 消息去重和 delta 渲染回归 |
| 真实环境 | `real-environment.test.js`, `real-env-chaos.test.js` | 真实 OMP 环境集成测试 |

### 8.3 集成测试（Bun Test + Mock）

集成测试按需 mock OMP 框架，不 mock 整个 oh-my-pi 运行时。只 mock `pi` 对象的必要方法（`registerCommand`, `registerTool`, `on`, `createAgentSession`），其余保持真实。

Mock pi 详见 `test/helpers/mock-pi.js`。

### Squad 流程 (`squad-flow.test.js`)
- M 模式：从 init → approve 完整流程
- M 模式：reject → retry → approve
- L 模式：2 节点并行
- L 模式：链式依赖
- L 模式：菱形依赖
- L 模式：外层 review reject → active → 重新 delegate
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

RPC 协议格式详见 `test/helpers/rpc-tmux.js`。OMP RPC 使用 JSONL，`type` 字段标识命令，`id` 关联响应。异步事件（`agent_start`/`message_delta`）无 `id`。

自动化驱动代码详见 `test/helpers/rpc-tmux.js`。测试用例覆盖：基础连接、get_state、M/L 模式完整流程、bash 命令、异常命令。

### 8.4.4 真实环境测试 (`real-environment.test.js`, `real-env-chaos.test.js`)

- 通过 tmux 启动真实 `omp`，让插件走完整的 HTTP + WebSocket + Vite 链路
- 浏览器必须先验证 `GET /main.jsx` 返回客户端 bundle，再验证页面可见内容（例如 `.app-title`、Welcome view、DAG 视图）
- 真实环境不通过环境变量切换运行模式；用户侧只保留默认真实行为
- 在混沌扰动、刷新、重连之后，页面仍必须恢复到同一套 UI 状态



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


