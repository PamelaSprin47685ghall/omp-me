# Squad-Tau 项目要求

在任何操作之前，请仔细通读 PRD/*.md 每个都要全文阅读！切记！

## 代码约束

- 单函数不超过 40 行，超过了强制拆解
- 单文件不超过 200 行，超过了强制拆解
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
