# Extension 开发经验

## Bun 模块解析 Bug 与绕过方案

### 问题描述

Bun 在处理包的自引用 import 时存在 bug。当一个包的内部文件尝试 import 自己的包名时（例如 `@oh-my-pi/pi-ai` 的 `src/utils/discovery/gemini.ts` 中有 `import { ... } from "@oh-my-pi/pi-ai"`），会导致模块解析失败：

```
Cannot find module '@oh-my-pi/pi-ai' from '/path/to/@oh-my-pi/pi-ai/src/utils/discovery/gemini.ts'
```

这个问题在以下场景中特别明显：
- Extension 作为独立项目开发，尝试动态 import oh-my-pi 的包
- 包的自引用在 Node.js 中正常工作，但在 Bun 中失败

### 解决方案：使用文件路径绕过包名解析

**核心思路**：不使用包名（如 `@oh-my-pi/pi-ai`），而是直接使用文件的绝对路径来 import，完全绕过 Bun 的包名解析机制。

#### 示例代码

```javascript
// ❌ 错误：使用包名会触发 Bun 的解析 bug
const { completeSimple } = await import("@oh-my-pi/pi-ai");

// ✅ 正确：使用文件路径绕过包名解析
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const streamPath = join(
  homedir(),
  ".bun/install/global/node_modules/@oh-my-pi/pi-ai/src/stream.ts"
);
const piAi = await import("file://" + streamPath);
const response = await piAi.completeSimple(...);
```

#### 关键点

1. **使用 `file://` 协议**：必须加上 `file://` 前缀，让 Bun 将其视为文件路径而不是模块说明符
2. **动态构建路径**：使用 `homedir()` 和 `join()` 动态构建路径，避免硬编码
3. **选择正确的入口文件**：
   - 选择不会触发自引用的文件（如 `stream.ts`）
   - 避免选择会 import `discovery` 等有自引用问题的模块的文件

### Native Addon 冲突问题

#### 问题描述

当 extension 项目安装了自己的 oh-my-pi 依赖副本时，会导致 native addon 冲突：

```
cannot allocate memory in static TLS block
```

原因：
- oh-my-pi 全局安装时已经加载了 `@oh-my-pi/pi-natives`
- extension 的 node_modules 中也有 `@oh-my-pi/pi-natives`
- Native addon 不能在同一进程中被加载两次

#### 解决方案

**不要在 extension 项目中安装 oh-my-pi 的依赖**。相反：

1. **使用已加载的模块**：通过 `pi.pi` 访问 oh-my-pi 已经导出的功能
   ```javascript
   // ✅ 使用 pi.pi.convertToLlm 而不是 import
   const branchMessages = pi.pi.convertToLlm(agentMessages);
   ```

2. **动态 import 文件路径**：对于必须 import 的模块，使用文件路径而不是包名
   ```javascript
   // ✅ 直接 import 全局安装的文件
   const streamPath = join(homedir(), ".bun/install/global/node_modules/@oh-my-pi/pi-ai/src/stream.ts");
   const piAi = await import("file://" + streamPath);
   ```

### Extension vs Hook

#### Extension
- 通过 `config.yml` 的 `extensions` 字段配置路径加载
- 可以是独立的 npm 项目
- 模块解析基于 extension 文件的位置
- 适合复杂的、有自己依赖的扩展

#### Hook
- 放在 `~/.omp/agent/hooks/` 或项目的 `.omp/hooks/`
- 在 oh-my-pi 的主进程上下文中加载
- 可以直接 import oh-my-pi 的包（在 monorepo 中）
- 适合简单的、不需要额外依赖的扩展

**注意**：独立项目的 extension 即使改成 hook 格式，也不会自动被发现，除非放在标准的 hooks 目录中。

### 最佳实践

1. **避免静态 import oh-my-pi 包**
   ```javascript
   // ❌ 静态 import 会在模块加载时失败
   import { completeSimple } from "@oh-my-pi/pi-ai";
   
   // ✅ 动态 import 在函数内部，extension 能正常加载
   async function executeAdvisor() {
     const piAi = await import("file://" + streamPath);
     // ...
   }
   ```

2. **优先使用 oh-my-pi 提供的 API**
   - `pi.pi.*` - 访问 `@oh-my-pi/pi-coding-agent` 的导出
   - `ctx.sessionManager` - 访问 session 数据
   - `ctx.modelRegistry` - 访问模型注册表
   - `ctx.ui` - 使用 UI 组件

3. **检查 import 链**
   - 确保你 import 的文件不会间接触发有自引用问题的模块
   - 例如：`stream.ts` 不 import `discovery`，所以是安全的

4. **缓存清理**
   - Bun 的缓存有时会损坏（出现 null 字节等问题）
   - 遇到奇怪的模块解析错误时，清理缓存：
     ```bash
     rm -rf ~/.bun/install/cache
     bun install -g @oh-my-pi/pi-coding-agent --force
     ```

### 完整示例

参考 `advisor` extension 的实现：

```javascript
// 使用 pi.pi 访问已加载的功能
const branchMessages = pi.pi.convertToLlm(agentMessages);

// 使用文件路径 import 必需的模块
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const streamPath = join(
  homedir(),
  ".bun/install/global/node_modules/@oh-my-pi/pi-ai/src/stream.ts"
);
const piAi = await import("file://" + streamPath);
const response = await piAi.completeSimple(model, context, options);
```

这个方案虽然有点 hacky（硬编码了全局安装路径），但成功绕过了 Bun 的模块解析 bug，让 extension 能够正常工作。
