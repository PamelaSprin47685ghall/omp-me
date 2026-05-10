# 01 — 系统架构概览

## 项目定位

`minimax-search` 是 Oh My Pi 的一个扩展插件，仿照 `ollama-search` 的结构，调用 MiniMax 开放平台 API 提供三组能力：

| 工具 | 能力 | 后端依赖 |
|------|------|----------|
| `minimax_search` | 网络搜索 | MiniMax Token Plan Search API |
| `minimax_vision` | 图片理解 | MiniMax VLM API (VL 模型) |
| `minimax_fetch` | 复杂网页抓取 | `agent-browser` CLI + 重量级子会话 (subagent) |

## 目录结构

```
minimax-search/
├── index.js           # 主入口：注册三个工具 + /minimax-key 命令 + agent-browser 预检
├── shim.mjs           # 插件加载器
├── PRD/               # 本文档集
│   ├── 01-architecture.md
│   ├── 02-search.md
│   ├── 03-vision.md
│   └── 04-fetch.md
├── test/
│   └── plugin.test.js
└── README.md
```

## 技术架构

### 插件注册

`index.js` 导出默认异步函数 `minimaxSearchExtension(pi)`，在 Oh My Pi 的扩展加载时被调用。

- 通过 `pi.registerTool()` 注册三个工具
- 通过 `pi.registerCommand()` 注册 `/minimax-key` 命令
- 通过 `pi.on('input')` 拦截 `/minimax-key` 统一前缀
- 使用 `WeakSet` 保护重复注册（`registeredPluginApis`）

### 启动时预检

插件初始化时拿不到 `ctx`，使用惰性检测：在首次 `pi.on('input')` 有 `ctx` 时执行 `which agent-browser`。
- 不存在 → `ctx.ui.notify('error')` 通知用户安装
- 不影响其他工具的正常注册

### API 通信

认证方式统一为 `Authorization: Bearer <MINIMAX_API_KEY>`。

#### API 端点总表

| 用途 | 方法 | 路径 | Host 示例 |
|------|------|------|-----------|
| 网络搜索 | POST | `/v1/coding_plan/search` | `https://api.minimaxi.com` |
| 图片理解 | POST | `/v1/coding_plan/vlm` | `https://api.minimaxi.com` |
| 子会话模型（Anthropic 兼容） | POST | `/anthropic/v1/messages` | `https://api.minimaxi.com` |

Search 和 Vision 使用裸 Host 路径；子会话的 MiniMax-M2.7 走 Anthropic Messages API 兼容路径，需加 `/anthropic` 前缀。

#### API Host 双区域支持

| 区域 | Host |
|------|------|
| 中国站 | `https://api.minimaxi.com` |
| 国际站 | `https://api.minimax.io` |

通过 `MINIMAX_API_HOST` 环境变量配置，默认中国站。

### Fetch 子会话模式

`minimax_fetch` 使用重量级子会话，不是简单 HTTP 调用。子会话拥有：
- `bash` — 运行 `agent-browser` CLI
- `read` — 读取本地文件
- `minimax_vision` — 图像理解能力（截图后分析）

子会话可以自主决策：导航子页面、截图、视觉识别、聚合多页面内容后返回综合结果。

生命周期控制复用 squad 模式：
1. 执行时预检 `agent-browser` 可用性，不可用直接拒绝
2. 通过 `pi.pi.createAgentSession()` 创建子会话
3. 注入 `minimax_vision` 为自定义工具 + `return_work` 生命周期工具
4. 空转保护（20 轮）+ 超时保护（120s）

### 认证与密钥管理

- 环境变量 `MINIMAX_API_KEY`（主路径）
- 环境变量 `MINIMAX_API_HOST`（可选，默认中国站）
- 命令 `/minimax-key <key>` 将密钥持久化到 `~/.omp/agent/minimax.json`
- 密钥按优先级：进程内存 > 文件持久化 > 环境变量

### 参考实现

- `ollama-search/` — 整体插件注册模式、API Key 管理、错误处理
- `squad/review-fsm.js` — 子会话创建（`createAgentSession`）、`return_work` 生命周期工具、空转保护
- `squad/outer-review.js` — 子会话启动的最小示例
- `agent-browser` CLI — 浏览器自动化指令集
