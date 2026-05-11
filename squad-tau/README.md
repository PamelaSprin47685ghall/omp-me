# Squad-Tau

Squad（DAG 多代理编排）与 Tau-Mirror（Web UI 实时镜像）深度集成的 oh-my-pi 插件。

## 架构

```
User → /squad command → Squad Engine → DAG Executor → Worker/Reviewer Agents → WebSocket → React UI
```

- **纯 JavaScript**（前后端统一 JSX）
- **事件驱动**：无 proxy、无文件轮询
- **≤200 行/文件**强制拆分原则
- **WebSocket 实时推送** + 增量渲染

## 快速开始

```bash
# 在 oh-my-pi 中加载插件后
/squad Implement a sorting algorithm in JavaScript
/squad-models          # 生成默认模型池配置
```

浏览器打开 `http://127.0.0.1:9527` 查看实时 UI。

## 命令

| 命令 | 说明 |
|------|------|
| `/squad <task>` | 启动 squad 多代理任务 |
| `/squad-models` | 初始化模型池配置文件 |

## 执行模式

- **M 模式**：单节点，内聚任务 → Worker → Self-Confirm → Reviewer → Approved
- **L 模式**：多节点 DAG，可并行任务 → 拓扑排序 → 分层并发 → 外层 Review 循环

## 项目结构

```
squad-tau/
├── index.js              # 插件入口
├── server/               # 服务端 (38+ 个 JS)
│   ├── squad-engine.js   # 命令注册与 FSM 编排
│   ├── dag-*.js          # DAG 验证/排序/执行/并发
│   ├── run-*.js          # Worker/Confirm/Reviewer 执行器
│   ├── model-pool*.js    # 模型池管理
│   ├── ws-*.js           # WebSocket 服务器/事件/心跳
│   └── *.js              # 状态机/事件总线/工具函数
├── client/               # 前端 (30 个 JSX/JS)
│   ├── components/       # 14 个 React 组件
│   ├── hooks/            # 6 个自定义 Hook
│   └── session-reducer.js# 纯函数状态管理
└── test/                 # 340+ 个测试用例
```

## 测试

```bash
bun test test/unit/          # 单元测试 (300+ 用例)
bun test test/integration/   # 集成测试 (22+ 用例)
bun test                     # 全部测试 (340+ 用例)
```

## 依赖

- **运行时**：React 18, Blueprint.js 6, Vite 8, ws, mermaid
- **开发**：Bun, Puppeteer, happy-dom

## 许可证

私有项目 — oh-my-pi 插件
