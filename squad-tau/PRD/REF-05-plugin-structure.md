# REF-05: 参考插件结构

> 路径：`../block-head-tail/`、`../ollama-search/`

## 标准插件文件布局

### `block-head-tail/`

```
block-head-tail/
├── index.js       # 插件主体
├── test/
│   └── plugin.test.js
├── SPEC.md        # 插件规格
└── README.md
```

### `ollama-search/`

```
ollama-search/
├── index.js
├── test/
│   └── plugin.test.js
├── SPEC.md
└── README.md
```

### `index.js` 标准入口模式

```javascript
export default async function myPlugin(pi) {
  // 1. 注册命令
  pi.registerCommand('my-command', { handler: async (args, ctx) => { ... } });

  // 2. 注册工具
  pi.registerTool('my_tool', { definition: ..., handler: async (input, ctx) => { ... } });

  // 3. 订阅事件
  pi.on('event_name', async (event, ctx) => { ... });
}
```

### `test/plugin.test.js` 标准测试模式

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import myPlugin from '../index.js';

describe('MyPlugin', () => {
  // Mock pi object
  const pi = { registerCommand: () => {}, registerTool: () => {}, on: () => {} };

  it('should register commands', async () => {
    const calls = [];
    const pi = { registerCommand: (name) => calls.push(name), ... };
    await myPlugin(pi);
    expect(calls).toContain('my-command');
  });
});
```
