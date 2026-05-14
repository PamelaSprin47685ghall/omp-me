# Squad-Tau PRD — 06 模型池管理

**核心哲学**：模型池被降维成了单纯的**数学计数器**。不存在 `ModelPool` 类、不存在 `acquire()` 异步等待队列、不存在 `release()` 唤醒逻辑。资源分配由 Reactor 动态裁决——通过 EventLog 投影后的**静态槽位 Map** 计算可用性。资源释放由节点终结事实自然触发。

## 6.1 数学模型

```
模型池 = 槽位配置（slots: Array<Slot>） + 使用表（usage: Map<slotId, {inUse, nodeId, role}>）

角色可用槽位数 = slots.filter(s → s.role === R).length - usage.filter(u → u.role === R).length

slot闲置判定 = usage[slotId] === undefined
```

Reactor 每次 pulse 时：
1. **分配**：扫描处于 authoring/confirming/reviewing 状态但未分配模型的节点 → 查找角色匹配的空闲槽位 → 差值 > 0 则推导 `model_pool:acquire` 事实
2. **释放**：扫描 usage 表中所有条目 → 如果对应的节点已处于 terminal 状态（approved/failed/blocked）→ 推导 `model_pool:release` 事实
3. **空池绕过**：如果角色槽位数 === 0（未配置），跳过 acquire，直接推导 `cmd:create_session` 使用当前会话模型

## 6.2 配置文件

- 路径：`{cwd}/.omp/models.toml`（当前工作目录下的 `.omp/models.toml`）
- 解析方式：使用 `Bun.TOML.parse()` 解析（`model-pool-config.js`），非 Bun 环境抛出错误
- 保存方式：手动字符串拼接生成 TOML 格式（`saveModelsConfig`），非使用 TOML 序列化库
- 格式示例：
```toml
[[slot]]
provider = "anthropic"
model_id = "claude-3-5-sonnet-20241022"
role = "worker"
thinking_level = "medium"

[[slot]]
provider = "anthropic"
model_id = "claude-3-5-haiku-20241022"
role = "reviewer"
```

## 6.3 数据流（无类、无队列）

```
配置文件变更 / WebSocket model_pool:update
    → model_pool:config_update 追加到 EventLog
    → Projections 增量折叠 → state.modelPool.slots 更新
    → Reactor 下次 pulse 重新计算差值
    → 推导 acquire/release 事实
```

**异步等待模拟**（非真等待）：如果某节点需要 worker 模型但无空闲槽位，Reactor 在本轮 pulse 中不对此节点产生任何动作。下次 pulse（由任意后续事实触发）会重新尝试。这不构成"等待队列"——只是 Reactor 的约束自然传导。

## 6.4 浏览器端实时调整

### 工作机制
1. 浏览器发送 `model_pool:update` WebSocket 消息
2. 服务端收到后追加 `model_pool:config_update` 事实到 EventLog
3. 同时持久化到 `.omp/models.toml`
4. EventLog 变更触发 Engine Pulse → Projections 更新 → `model_pool:changed` 广播到所有连接
5. 所有浏览器收到变更后通过 applyEvent 更新本地 State → UI 自动反映新槽位配置

### 操作类型

| 操作 | 行为 | EventLog 事实 |
|------|------|---------------|
| `add` | 追加新槽位，初始为可用 | `model_pool:config_update {action: 'add', slot}` |
| `remove` | 从配置和投影中移除槽位 | `model_pool:config_update {action: 'remove', slotId}` |
| `edit` | 修改 `thinkingLevel` | `model_pool:config_update {action: 'edit', slotId, thinkingLevel}` |

**删除正在使用中的槽位**：投影只是从 `slots` 数组中移除该槽位。已分配的 session 继续运行不受影响（`usage` 表仍然持有该 `slotId`）。当 Reactor 下次检测到该节点终结时，release 事实会清理 `usage` 条目——释放的 `slotId` 已不存在于 `slots` 中，不会重新分配。

## 6.5 文件变更同步

- 使用 `fs.watchFile` 监听 `.omp/models.toml` 变更
- 检测到变更后，对比新旧配置的槽位差异，追加对应的 `model_pool:config_update` 事实
- **300ms 防抖**（`model-pool-config.js` 中 `setTimeout`）避免高频写入时的竞态
- 注意：这是系统中唯一残留的定时器。它不决定任何业务逻辑，只是文件 I/O 合并优化

## 6.6 与 Squad 引擎的集成

### 模型分配优先级（纯投影查询，无状态类）

1. **优先使用模型池**：Reactor 检查 `state.modelPool.slots` 中是否有角色匹配的空闲槽位
2. **回落到当前会话模型**：如果角色槽位数为 0（无任何配置），跳过 acquire 直接创建 session
3. **当前会话模型无上限**：使用当前会话模型时不做并发限制，多个 worker 可同时使用

### 工作流程（纯事实驱动）

```
节点 → status=authoring → Reactor 检查 model pool 投影
  ├─ 有空闲槽位 → model_pool:acquire → session:start → session:tool_call(return) → node_state
  └─ 无槽位 → 静默等待（下次 pulse 再检查）
节点 → terminal → Reactor 检查 usage 表 → model_pool:release
```

### 其他
- 节点执行完毕后（无论成败），Reactor 推导 `model_pool:release` 事实
- **无限并发**：不设硬编码并发上限，并发度仅受模型池槽位数限制。槽位越多，并行度越高
- 无信号量、无 Promise.race、无异步队列——纯 EventLog + Projections 推导
