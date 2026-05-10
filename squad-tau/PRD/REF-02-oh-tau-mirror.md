# REF-02: oh-tau-mirror 适配层参考

> 路径：`../oh-tau-mirror/`

## `index.js`

oh-my-pi 适配桥接入口。将 `pi` (ExtensionAPI) 映射为 tau-mirror 期望的 API。

| 导出 | 用途 |
|------|------|
| `default ohTauMirrorAdaptor(pi)` | 插件入口，加载 tau-mirror 并桥接 |
| `createBridge(pi)` | 桥接工厂函数 |

| 关注点 | 说明 |
|--------|------|
| 事件注册 | `pi.on('session_start/turn_start/turn_end/message_start/message_update/message_end/agent_start/agent_end/…')` |
| 端口拦截 | `interceptPort()` — 拦截 `pi.setStatus('mirror', port)` 替换为 proxy 端口 |
| 控制台静音 | 抑制 tau-mirror 自身控制台输出 |
| 事件过滤 | 忽略 `model_select` 等 tau-mirror 不支持的事件 |
| 会话追踪 | 通过 `pi.on('session_start')` 追踪当前 session 文件 |

## `proxy.js`

MITM Proxy，位于浏览器与 tau-mirror 之间。

| 导出 | 用途 |
|------|------|
| `setTauPort(port)` | 设置 tau-mirror 端口并启动 proxy |
| `getProxyPort()` | 获取 proxy 监听端口 |
| `addSessionFile(sf)` | 注册已知 session 文件 |
| `isKnownSessionFile(sf)` | 检查文件是否已注册 |
| `activateSessionFile(sf)` | 强制浏览器切换到指定 session |
| `forwardSubagentEvent(event, sessionFile)` | 转发 subagent 事件，附带 `__sessionFile` 标记 |
| `normalizeSessionFile(sf)` | 规范化 session 文件路径 |

| 内部机制 | 说明 |
|---------|------|
| `browserClients` | 所有连接的浏览器 WebSocket 集合 |
| `knownSessions` / `knownSessionFiles` | 已知 session 注册表 |
| 透明转发 | `browserWs.on('message')` → 直接 `upstreamWs.send(data)` |
| 多会话路由 | `forwardSubagentEvent()` 向事件附加 `__sessionFile`，浏览器据此区分 |
| 会话目录轮询 | 扫描 `~/.omp/agent/sessions/`，80ms 防抖 |
| 消息修剪 | `message_update` 事件中的 `message` 字段被删除以节省带宽 |
| 端口分配 | tau-mirror 端口 +1000 起尝试，冲突 +1000 递增 |

## `injected.js`

在 `/app.js` 末尾注入的浏览器端代码，实现多会话路由覆盖。

| 关注点 | 说明 |
|--------|------|
| 注入时机 | proxy 拦截 `/app.js` 响应，在末尾追加 |
| 覆盖目标 | tau-mirror 全局 `latestCtx`、`handleMirrorSync()` 等 |
| 功能 | 使浏览器能跟踪和显示多个 session（squad worker/reviewer 会话） |

## `shim.mjs`

oh-my-pi 插件标准 shim 导出，格式参考。

```javascript
import { loadPlugin } from '@oh-my-pi/shim';
export default loadPlugin(import.meta.url);
```
