# Squad-Tau PRD — 08 测试策略

**核心哲学**：不再使用 Puppeteer DOM 轮询 + Mock 等待时序 + 虚假的事件总线注入。新测试架构建立在系统的数学本质之上——Reactor 是纯函数，测试就应该像代数断言一样确定、零耗时。

## 8.1 新测试金字塔

```mermaid
graph TD
    subgraph 顶层
        RC[Real-Env Chaos 测试\n物理链路 Tmux + 浏览器\n验证断网/乱序/中断不丢状态]
    end
    subgraph 中层
        TT[时空折叠器 Time-Traveler\n内存 while 循环 + 伪造 SideEffect\n100 步推演验证因果律不变量]
    end
    subgraph 底层
        AT[代数断言 Algebraic Tests\n给定静态 State → 断言 Action[]\n0 毫秒执行 · 100% 边界覆盖]
    end
```

| 层 | 执行时间 | 数量级 | 运行频率 | 依赖 |
|---|----------|--------|----------|------|
| 代数断言 | ~0ms（纯函数） | 大量（50+ 场景） | 每次提交 | 无 |
| 时空折叠器 | ~1ms（内存循环） | 中量（10+ 场景） | 每次提交 | 无 |
| 真实混沌 | ~30s（物理链路） | 少量（2-3 场景） | 释放前 | Puppeteer + Tmux |

## 8.2 底层：代数断言（Algebraic Tests）

**原理**：Reactor 是纯函数 `f(State) → Action[]`。测试直接构造输入 State（通过 `project()` 或手动 `buildState()`），断言输出的 Action 数组符合预期。

**语法**：
```javascript
// 给定一个 EventLog 序列
const log = [];
log.append(Events.SQUAD_INIT, { mode:'M', nodes:[{id:'n1',...}], originalTask:'t' });
log.append(Events.SQUAD_NODE_STATE, { nodeId:'n1', status: STATUS.AUTHORING });
// ...

// 折叠得到当前 State
const state = project(log.getSince(0));

// Reactor 纯函数推导 → 断言 Action[]
const actions = reactState(state);
expect(actions.filter(a => a.type === Events.MODEL_POOL_ACQUIRE).length).toBe(1);
```

**核心断言类别**：

| 类别 | 断言内容 | 边界值 |
|------|----------|--------|
| 初始状态 | SQUAD_INIT 后，所有节点得到 idle 状态 | 0 节点 / 1 节点 / N 节点 |
| 依赖传导 | 上游 failed → 下游 blocked | 链式/菱形/扇出 |
| 模型获取 | authoring 节点 + 空闲槽位 → MODEL_POOL_ACQUIRE | 0 槽位 / 1 槽位 / 多槽位 |
| 空池降级 | 无配置槽位 → 直接 CMD_CREATE_SESSION | worker/reviewer 分别空 |
| 阶段推进 | 有 return('ok') → 下一 node_state | authoring→confirming→reviewing→approved |
| 驳回重试 | return('error') + retryCount < MAX → 回 authoring | retryCount = 0..MAX-1 |
| 超限失败 | return('error') + retryCount >= MAX → failed | MAX 边界 |
| 释放规则 | terminal 节点 → MODEL_POOL_RELEASE | approved/failed/blocked |
| 外层 review | 全部 approved → SQUAD_OUTER_REVIEW_START | M 模式 / L 模式 |
| 外层驳回 | 外审 rejected → 节点重置回 authoring | retryCount 递增 |
| 并发分配 | 3 节点等待 2 槽位 → 恰好 2 个 acquire | 槽位 > 节点 / 槽位 < 节点 / 槽位=0 |

### 辅助工具

- `test/helpers/state-builder.js`：`buildState()` 和 `nodeInPhase()` 快速构造特定阶段的 State
- `test/helpers/assertions.js`：通用断言封装

### 关键测试文件

| 文件 | 覆盖 |
|------|------|
| `test/unit/reactor-orthogonal.test.js` | 正交单元测试：每个规则独立验证 |
| `test/unit/reactor-dag-invariants.test.js` | DAG 因果律不变量：依赖链、环、菱形 |
| `test/unit/reactor-failure-paths.test.js` | 失败路径：驳回、超限、阻塞、中止 |
| `test/unit/reactor-squad-complete.test.js` | 完成路径：各种模式的 squad:complete 触发 |
| `test/unit/reactor-outer-review.test.js` | 外层 review 规则 |
| `test/unit/reactor-chain-trace.test.js` | 链式追踪：事件序列的顺序不变性 |

## 8.3 中层：时空折叠器（Time-Traveler）

**原理**：模拟完整的 Engine Pulse 循环——在内存中 `while` 循环反复调用 `reactState()` + 伪造 SideEffect 执行业务动作 + 将结果追加回 EventLog。直到反应链收敛（`reactState` 返回 `[]`）。

```javascript
function timeTravel(initialEvents, promptBehavior) {
    // 1. 初始 EventLog
    // 2. while 循环：reactState → append → fake exec → append → repeat
    // 3. 返回最终 EventLog
}
```

**这完全跳过异步 I/O**——所有 LLM 调用被替换为 `promptBehavior` 回调函数，直接返回 `{status: 'ok' | 'error'}`。循环在单线程内推演整个 DAG 生命周期。

### 验证的不变量

| 不变量 | 验证方式 |
|--------|----------|
| DAG 因果律 | 任意时间点，下游节点绝不早于上游节点进入 authoring |
| 模型配对 | 每个 acquire 最终都有对应的 release |
| 并发安全 | 任何时刻同一 slotId 不被双重 acquire |
| 最终收敛 | while 循环始终在有限步内终止（200 步硬限+断言收敛） |
| 空 usage | 结束后 `state.modelPool.usage` 为空 |
| 最后事件 | `SQUAD_COMPLETE` 总是最后一个事件 |

### 关键测试文件

| 文件 | 覆盖 |
|------|------|
| `test/integration/time-traveler.test.js` | 主时间旅行测试：M 模式、链式、菱形、驳回、外审 |
| `test/integration/fuzzing.test.js` | 模糊推演：随机 promptBehavior、随机 DAG 结构 |

## 8.4 顶层：真实混沌（Real-Env Chaos）

**原理**：保留一组最小化但至关重要的物理链路测试。使用 Tmux 启动真实 `omp` + Puppeteer 控制浏览器，验证 WebSocket 水位线同步在断网、乱序、用户暴力操作中绝不丢失状态。

### 驱动原语

| 原语 | 实现 |
|------|------|
| `setup()` | `tmux new-session -d 'omp'` |
| `type(text)` | `tmux send-keys ... Enter` |
| `press(key)` | `tmux send-keys C-c / Escape` |
| `screenshot()` | `tmux capture-pane -p` |
| `isAlive()` | `tmux has-session` |
| `browser(url)` | Puppeteer → `http://127.0.0.1:<port>` |
| `teardown()` | `tmux kill-session` + `browser.close()` |

### 混沌攻击面

| 攻击面 | 验证目标 |
|--------|----------|
| Ctrl+C 连发 | 进程不死锁、不 segfault |
| 运行时浏览器刷新 | WebSocket 重连后状态完全恢复 |
| 多 Tab 一致性 | 多个浏览器看到的 UI 状态一致 |
| 暴力 steer | 自然语言消息中断 + 矛盾指令 → 最终正常完成 |
| 模型池面板操作 | 增删槽位中执行 squad → 正确降级/恢复 |
| 恢复能力 | 多次中断 → 最后一次正常完成 |

### 关键测试文件

| 文件 | 覆盖 |
|------|------|
| `test/real-env/real-environment.test.js` | 基础链路：页面加载、WS 连接、squad 提交 |
| `test/real-env/real-env-chaos.test.js` | 混沌测试：中断、恢复、多 Tab |
| `test/e2e/chaos-ui-e2e.test.js` | 浏览器端混沌：模型池面板操作 + 多 Tab 同步 |

## 8.5 测试执行策略

```bash
# 日常开发（毫秒级）
bun test test/unit/reactor-*.test.js
bun test test/integration/time-traveler.test.js

# 提交前（秒级）
bun test test/unit/ test/integration/

# 释放前（分钟级）
bun test test/real-env/  # 需要 omp + Tmux + Puppeteer
```

### 已移除的旧测试类型

| 旧类型 | 移除原因 | 替代方案 |
|--------|----------|----------|
| Puppeteer DOM 轮询 | 不可靠、慢、脆弱的 selector 依赖 | 代数断言验证 Reactor 输出 + 时空折叠器验证全流程 |
| Mock 等待时序 | 掩盖竞态 | 时空折叠器的同步推演暴露所有竞态 |
| EventBus 注入测试 | 模拟事件总线是假测试 | 代数断言直接输入 State 对象 |
| 拓扑排序单元测试 | Kahn 算法已被替代 | 声明式依赖规则测试（reactor-dag-invariants） |
| 模型池 acquire/release 时序 | `ModelPool` 类已删除 | 槽位差值的代数断言 + 配对齐等性验证 |
