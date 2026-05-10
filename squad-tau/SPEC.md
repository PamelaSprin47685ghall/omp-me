# Squad-Tau 规格说明

## 概述

Squad-Tau 是一个 oh-my-pi 插件，提供 DAG 多代理编排能力与实时 Web UI。完全重新实现 tau-mirror 功能，采用全新事件驱动架构。

## 核心流程

```
/squad <task>
  → 创建 EventBus + HTTP/WS 服务器 + ModelPool
  → Agent 调用 submit_plan({ mode, nodes })
  → DAG Executor 拓扑排序 + 分层执行
  → 每节点: Worker → Self-Confirm → Reviewer
  → (L 模式) 外层 Review → Approve / Revise
  → squad:complete 事件
```

## 节点生命周期

```
waiting_deps → pending → authoring → confirming → reviewing → approved
                                                                  ↓
                                                               rejected → (retry)
```

## 事件协议

所有 WebSocket 消息格式：`{ type, payload, timestamp }`

| 事件方向 | 类型 | 用途 |
|---------|------|------|
| S→C | `connection:established` | 连接确认 |
| S→C | `squad:init` | Squad 启动 |
| S→C | `squad:node_state` | 节点状态变更 |
| S→C | `squad:complete` | Squad 完成 |
| S→C | `session:message` / `message_delta` | 消息与流式文本 |
| S→C | `session:tool_call` / `tool_result` | 工具调用 |
| S→C | `model_pool:snapshot` / `changed` | 模型池状态 |
| C→S | `session:user_message` | 用户 steer 消息 |
| C→S | `model_pool:update` | 模型池修改 |
| C→S | `abort` | 中止 squad |

## 组件架构

### 服务端 (37 文件)

| 模块 | 文件 | 职责 |
|------|------|------|
| 状态机 | `state-machine.js` | 纯函数节点状态转换 |
| 事件总线 | `event-bus.js` | 命名空间+通配符事件 |
| DAG 引擎 | `dag-*.js` (4) | 验证/排序/执行/并发 |
| 节点执行 | `run-*.js` (7) | Worker/Confirm/Reviewer |
| 模型池 | `model-pool*.js` (3) | 配置/队列/事件 |
| 网络 | `ws-*.js` (4) | WS 服务器/路由/心跳/广播 |
| 引擎 | `squad-engine.js` | 命令注册/FSM |

### 前端 (30 文件)

| 模块 | 组件 | 职责 |
|------|------|------|
| Header | `Header.jsx` | 品牌/连接状态/DAG 切换/Abort |
| 侧栏 | `Sidebar.jsx`, `SessionTree.jsx` | 会话树/自动切换/锁定 |
| 主内容 | `MainContent.jsx` | DAG 视图/消息列表/输入 |
| 消息 | `MessageItem.jsx`, `MessageList.jsx` | 角色色带/流式渲染 |
| Thinking | `ThinkingBlock.jsx` | 折叠/RAF 合批 |
| 工具 | `ToolCall.jsx` | 卡片/Spinner/展开折叠 |
| DAG | `DAGView.jsx` | Mermaid 可视化 |
| 模型池 | `ModelPoolDrawer.jsx` | 表格/增删改/Alert 确认 |

### 模型池

- 配置文件：`~/.omp/squad/models.json`
- Worker/Reviewer 独立队列
- 池空时回落到当前会话模型
- 使用中槽位删除 → `pending_delete` 标记

## 性能指标

- WebSocket 消息频率 > 100/s
- 状态变更 UI 延迟 < 100ms
- 文件篡改检测 mtime 精度
- WebSocket 断线重连：指数退避 1s→30s

## 安全

- HTTP/WS 服务器仅绑定 127.0.0.1
- 不实现身份认证（localhost 安全模型）
- 远程访问通过 SSH 端口转发
