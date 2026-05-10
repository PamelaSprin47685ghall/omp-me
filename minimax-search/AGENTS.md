# Minimax-Search 项目要求

## 代码约束

- 单函数不超过 40 行，超过了强制拆解
- 单文件不超过 200 行，超过了强制拆解
- 纯 JavaScript（ESM），无 TypeScript
- 强制遵循 `ollama-search/` 的代码风格：无注释、极简错误处理、DRY
- 子会话模式复用 squad 的 `createAgentSession` + `return_work` 生命周期工具模式
- 命令统一前缀 `/minimax-`，工具统一前缀 `minimax_`
- `minimax_fetch` 子会话拥有完整推理能力：多页面导航、截图 + `minimax_vision` 图像理解、内容聚合
- 启动时预检 `agent-browser` 可执行性，不存在则 `ui.notify('error')` 要求安装
- 执行时再次校验 `agent-browser`，不存在则直接拒绝不降级

## 参考项目（相对 minimax-search/ 的路径）

| 项目 | 路径 | 用途 |
|------|------|------|
| Ollama Search（主参考） | `../ollama-search/` | 插件结构、shim.mjs、index.js 注册模式、API Key 管理、错误处理 |
| Squad（子会话模式参考） | `../squad/` | `review-fsm.js` 中的 `runSession`、`createAgentSession`、`return_work` 生命周期工具、空转保护 |
| Block Head Tail | `../block-head-tail/` | 参考插件结构（shim.mjs + index.js + test/） |
| System to User | `../system-to-user/` | 参考插件结构 |
| Shim 包 | `../shim-packages/pi-coding-agent/` | `createAgentSession`、`SessionManager` API 来源 |
| Shim 包 | `../shim-packages/pi-shim/` | oh-my-pi 插件 shim 导出格式 |
| Shim 包 | `../shim-packages/pi-resolve/` | `@oh-my-pi/resolve-pi` 内部依赖 |

## 参考网址

| 资源 | URL | 用途 |
|------|-----|------|
| MiniMax Token Plan MCP 文档 | https://platform.minimaxi.com/docs/guides/token-plan-mcp-guide | `web_search` 和 `understand_image` 工具说明 |
| MiniMax API 参考 | https://platform.minimaxi.com/docs/api-reference/api-overview | 全模态 API 概览 |
| MiniMax Search API | `POST {host}/v1/coding_plan/search` | 搜索接口端点（payload: `{q}`） |
| MiniMax MCP 源码（参考 API 调用） | https://pypi.org/project/minimax-coding-plan-mcp/ | 搜索和 VLM 的请求/响应格式验证 |
| MiniMax VLM API | `POST {host}/v1/coding_plan/vlm` | 图片理解接口端点（payload: `{prompt, image_url}`） |
| agent-browser（浏览器自动化） | https://github.com/vercel-labs/agent-browser | 完整 CLI 命令参考 |
| agent-browser CLI 命令 | `agent-browser open <url>` | 打开 URL 导航 |
| agent-browser CLI 命令 | `agent-browser snapshot` | 获取 ARIA 可访问性树 + 元素 ref |
| agent-browser CLI 命令 | `agent-browser get text <sel>` | 获取元素文本 |
| agent-browser CLI 命令 | `agent-browser get title` | 获取页面标题 |
| agent-browser CLI 命令 | `agent-browser click <sel>` | 点击元素（支持 ref 如 @e3 或 CSS） |
| agent-browser CLI 命令 | `agent-browser screenshot <path>` | 全页面截图 |
| agent-browser CLI 命令 | `agent-browser eval <js>` | 执行任意 JS |
| MiniMax 开放平台 | https://platform.minimaxi.com/user-center/basic-information/interface-key | 获取 MINIMAX_API_KEY |

## API Host 双区域

| 区域 | Host |
|------|------|
| 中国站 | `https://api.minimaxi.com` |
| 国际站 | `https://api.minimax.io` |

默认使用中国站，通过 `MINIMAX_API_HOST` 环境变量覆盖。
