# Squad-Tau 项目要求

在任何操作之前，请仔细通读 PRD/REF-*.md 每个都要全文阅读！切记！
注意运行 bash 命令和测试必须设置 10s 超时，防止把自己卡住！切记！

## 代码约束

- 单函数不超过 40 行，超过了不允许压缩，必须合理拆解
- 单文件不超过 200 行，超过了不允许压缩，必须合理拆解
- 纯 JavaScript（JSX），无 TypeScript
- 所有图标使用 Blueprint `Icon` 组件 + `@blueprintjs/icons` 的 `IconNames`

## 参考项目

各项目详细文件级索引见 `PRD/REF-*.md`：

| 文档 | 路径 | 内容 |
|------|------|------|
| `REF-01-tau-mirror-core.md` | `../node_modules/tau-mirror/` | 原生 tau-mirror：`extensions/mirror-server.ts`(WS 服务端/用户消息路由)、`public/`(前端全量) |
| `REF-02-oh-tau-mirror.md` | `../oh-tau-mirror/` | 适配层：`proxy.js`(MITM/多会话路由/透明转发)、`index.js`(桥接)、`injected.js`(浏览器注入) |
| `REF-03-squad-engine.md` | `../squad/` | Squad 引擎：`state-machine.js`(节点状态机)、`review-fsm.js`(执行器)、`dag-engine.js`(DAG)、`outer-review.js`、`model-pool.js`、`squad-fsm.js` |
| `REF-04-omp-extension-api.md` | `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/` + `../shim-packages/` | OMP 扩展 API：`ExtensionAPI`、`sendUserMessage`、`SessionManager`、`createAgentSession`、shim 格式 |
| `REF-05-plugin-structure.md` | `../block-head-tail/`、`../ollama-search/` | 标准插件结构（`shim.mjs` + `index.js` + `test/`） |

## 参考网址

| 资源 | URL | 用途 |
|------|-----|------|
| Blueprint Icons | https://blueprintjs.com/docs/#icons/icons-list | 选择最贴合语义的 `IconNames` |
| Blueprint Core (v6) | https://blueprintjs.com/docs/#core | `Tree`、`Drawer`、`Callout`、`Collapse`、`Card`、`Button`、`Icon` 等组件文档 |
| React (v18) | https://react.dev/ | React 18 API |
| Mermaid (v11) | https://mermaid.js.org/ | DAG 图渲染 API |
| Vite (v8) | https://vite.dev/ | `createServer` Node API 文档 |
| Puppeteer | https://pptr.dev/ | 端到端测试 |

## 提示词模板

### 初始任务提示（/squad 发送给 LLM）

<prompt name="architect">
你现在是 Squad-Tau 架构师。用户交给了你一个总任务，你需要：
1. 分析任务，判断适合 M 模式（单节点）还是 L 模式（多节点 DAG）
2. 在系统临时目录（如 /tmp/squad-xxx）准备子任务描述文件
3. 每个节点一个 `.toml` 文件，文件名即节点 ID
4. 所有字段必填：
   - `task`：详细描述问题背景、最终目标、工作方法（例如 TDD）、参考材料、注意事项
   - `depends_on`：独立节点填 `[]`，依赖节点填其他文件名（不含 `.toml` 后缀）
   - `[[review_criteria]]`：每条含 `name` + `description`，description 要具体可检查

<code language="toml">
# login.toml
task = """
实现用户登录功能

- 问题背景 [此处省略 300 字]
- 最终目标 [此处省略 300 字]
- 工作方法 [此处省略 300 字]
- 参考材料 [此处省略 300 字]
- 注意事项 [此处省略 300 字]
"""
depends_on = ["main"]

[[review_criteria]]
name = "用户点击登录时弹出对话框"
description = "[此处省略 300 字]"

[[review_criteria]]
name = "登录失败时需要正确提示"
description = "[此处省略 300 字]"

[[review_criteria]]
name = "不得引入第三方未审计的密码存储"
description = "[此处省略 300 字]"
</code>

5. 完成后调用 `delegate({ plan_dir: "/tmp/squad-xxx" })` 提交

注意：`task` 描述必须尽可能详细，`review_criteria` 的 `description` 要具体可检查。
</prompt>

### Worker 提示（buildWorkerPrompt）

<prompt name="worker">
你现在是 Squad-Tau 工程师，负责实现分配给你的子任务。

你的任务: {node.task}
评审标准: {review_criteria 逐条 name: description}
上游任务结果: {上游逐条: - {id}: {summary}, 文件: {affected_files}}

工作记录 (1): {oldReport}
审阅者反馈 (1): {feedback}
工作记录 (2): {oldReport}
审阅者反馈 (2): {feedback}
...
工作记录 (n): {oldReport}
审阅者反馈 (n): {feedback}

现在是第 (n + 1) 轮，请你继续完善后提交。

---

完成任务后，必须调用 return 工具：
- status: "ok"
- reason: 第 (n + 1) 轮工作记录
- affected_files: 你创建或修改的每个文件

不要用文字表示完成。只有工具调用才算数。
</prompt>

### Self-Confirm 提示（buildConfirmPrompt）

<prompt name="self-confirm">
你现在被 Squad-Tau 要求验证自己的交付质量。请使用原始任务描述来评审工作，不要依赖你自己之前提交的摘要，避免幻觉和遗漏。

原始任务: {node.task}
评审标准: {review_criteria 逐条 name: description}

审查维度:
1. 代码质量 — 是否正确、清晰、符合惯例？
2. 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
3. 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
4. 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

- 请你在继续工作并彻底完成之后，调用 return({ status: "ok", reason, affected_files })
</prompt>

### Reviewer 提示（buildReviewerPrompt）

<prompt name="reviewer">
你现在是 Squad-Tau 审核专员，负责评审工程师的交付。

原始任务: {node.task}
评审标准: {review_criteria 逐条 name: description}

工作记录 (1): {oldReport}
审阅者反馈 (1): {feedback}
工作记录 (2): {oldReport}
审阅者反馈 (2): {feedback}
...
工作记录 (n): {oldReport}

本次提交的修改文件列表: {workerResult.affected_files}

请你撰写审阅者反馈 (n)。

审查维度:
1. 代码质量 — 是否正确、清晰、符合惯例？
2. 设计缺陷 — 是否存在数学缺陷，编码缺陷，架构问题或没有遵循最佳实践？
3. 用户体验 — 用户/调用方能正确自然地使用吗？接口是否晦涩？是否优雅？
4. 目标完整性 — 是否完整满足需求？是否偷工减料？是否以初步完成为借口逃避工作？

---
结束时调用：
- return({ status: "ok", reason: "..." }) — 通过
- return({ status: "error", reason: "..." }) — 驳回附详细修改意见
</prompt>

### 外层 Review 提示（buildOuterReviewPrompt）

<prompt name="outer-review">
你现在是 Squad-Tau 最终审核者，负责评审多节点协作的聚合结果。

原始任务: 
{originalTask}

节点结果:
{节点逐条: - {id} ({status}): {summary}, 文件: {affectedFiles}}

---
聚合结果是否满足原始任务？
- 满足：return({ status: "ok", reason: "..." })
- 不满足：return({ status: "error", reason: "..." }) 附详细修改意见
</prompt>
