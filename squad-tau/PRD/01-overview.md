# Squad-Tau PRD — 01 概述

**Version**: 1.1.0
**Date**: 2026-05-10
**Status**: Final（根据实际代码行为修订）

## 1.1 项目定位

Squad-Tau 是一个将 Squad（DAG 多代理编排）和 Tau-Mirror（Web UI 实时镜像）深度集成的 oh-my-pi 插件。它完全重新实现 tau-mirror 的所有功能，不再引用外部 tau-mirror 包，并采用全新的事件驱动架构。

## 1.2 核心能力

- **DAG 任务编排**：M 模式（单节点）和 L 模式（多节点并行 + 外层 review）
- **Worker-Reviewer 强制循环**：每个节点经过 authoring → self-confirm → review → approved/rejected
- **实时 Web UI**：React + Blueprint.js 构建的现代化界面，实时显示所有会话、DAG 状态、thinking 流
- **事件驱动架构**：无 proxy 层，无文件轮询，纯 WebSocket 事件流
- **浏览器端模型池管理**：实时调整 worker/reviewer 槽位
- **用户消息 steer**：用户可从 Web UI 向任意活跃 session 发送消息（主会话或 squad 子会话），通过自然语言实时指导 agent 工作方向

## 1.3 架构变化（与之前不兼容）

| 项目 | 旧架构 (squad + tau-mirror) | 新架构 (squad-tau) |
|------|---------------------------|-------------------|
| 代理层 | MITM proxy 拦截 HTTP/WS | 无 proxy，直接 HTTP + WS 服务器 |
| 会话数据 | 读取 JSONL 文件扫描目录 | 全事件驱动，不读 session 文件 |
| 防抖 | 80ms 防抖刷新侧边栏 | 天然防抖，事件触发即推 |
| 传输 | 全量消息同步 | delta 渲染，只传增量 |
| 前端 | tau-mirror 自带 UI | React + Blueprint.js 全新实现 |
| 协议 | tau-mirror 协议兼容 | 全新事件协议 |
| 语言 | TypeScript 前端 + JS 服务端 | 纯 JavaScript（前后端都 JS） |
| HTTP 端口 | 固定端口 9527 | OS 随机分配（`server.listen(0)`），无需端口冲突处理 |
| DAG 渲染 | mermaid | `beautiful-mermaid`（内置暗色主题支持，无需额外 CSS） |
| 模块解析 | 直接 import | 通过 `@oh-my-pi/resolve-pi` 的 `importNodeModule` 动态解析 |
