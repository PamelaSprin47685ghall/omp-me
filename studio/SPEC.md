# Studio — oh-my-pi 移植版

Pi Studio 是 [omaclaren/pi-studio](https://github.com/omaclaren/pi-studio) 的 oh-my-pi 移植版。提供双栏浏览器工作区：编辑 prompt、查看响应、批注、审阅、Markdown/LaTeX/代码实时预览。

## 目录结构

```
studio/
  index.js          # 主入口：扩展工厂、事件处理、服务器、状态管理
  theme.js          # 主题推断、调色板、CSS 变量生成
  shared/           # 共享模块（标注扫描、HTML 注释、LaTeX 字面量、PDF 转义）
  client/           # 浏览器端文件（CSS、客户端 JS、标注辅助）
  themes/           # pi-studio-dark / pi-studio-light 主题
  package.json      # 扩展元数据，依赖 ws
```

## 安装

1. 在 oh-my-pi 的 `~/.omp/agent/config.yml` 中添加：

```yaml
extensions:
  - /path/to/omp-me/studio/index.js
```

2. 重启 oh-my-pi。

## 命令

| 命令 | 作用 |
|---|---|
| `/studio [path\|--blank\|--last]` | 打开完整 Studio 视图 |
| `/studio-replace [path]` | 替换当前 Studio 视图 |
| `/studio-editor-only [path]` | 打开编辑器专用视图（可多个）|
| `/studio-current <path>` | 加载文件到当前打开的 Studio 标签页 |
| `/studio-pdf <path> [options]` | 导出文件为 PDF |
| `/studio --status` | 显示 Studio 服务器状态 |
| `/studio --stop` | 停止 Studio 服务器 |

## 移植说明

- 导入路径：`@mariozechner/pi-coding-agent` → 无顶层包导入，通过 `pi.pi.*` 运行时访问
- `getAgentDir` → 替换为 `join(homedir(), ".omp", "agent")` 惰性求值
- `model_select` 事件 → 移除（oh-my-pi 无此事件；通过 2s 间隔轮询刷新）
- TypeScript → JavaScript（bun build 转译）
- 主题系统抽离到独立 `theme.js` 模块
- `node:` 前缀补全（`node:http`, `node:path` 等）

## 依赖

- `ws`（WebSocket 服务器）

## 依赖项

- `pandoc`（用于 Markdown/LaTeX 预览渲染）
- `xelatex`（用于 PDF 导出）
