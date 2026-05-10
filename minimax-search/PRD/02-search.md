# 02 — 网络搜索工具 `minimax_search`

## API 契约

### 端点

```
POST {MINIMAX_API_HOST}/v1/coding_plan/search
Content-Type: application/json
Authorization: Bearer {MINIMAX_API_KEY}
```

### 请求

```json
{
  "q": "搜索查询词"
}
```

### 响应

```json
{
  "organic": [
    {
      "title": "结果标题",
      "link": "https://...",
      "snippet": "内容摘要",
      "date": "发布日期"
    }
  ],
  "related_searches": [
    { "query": "相关搜索建议" }
  ],
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

## 工具定义

### 名称

`minimax_search`

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `query` | string | ✓ | 搜索查询词 |

### 输出

格式化的 Markdown 列表：

```
1. 标题
   URL: https://...
   摘要内容

2. 标题
   URL: https://...
   摘要内容
```

`details` 中透传完整 `{ organic, related_searches }`。

## 错误处理

| 场景 | 行为 |
|------|------|
| `MINIMAX_API_KEY` 未设置 | 抛出"MINIMAX_API_KEY is not set — use /minimax-key" |
| HTTP 4xx/5xx | 抛出"Minimax API error (status NNN): body" |
| `base_resp.status_code` 非零 | 抛出对应错误消息 |
| 网络错误 | 传播原生 fetch 错误 |
| 无结果 | 返回 "No results found." |

## 完整性要求

- `query` 参数必须校验非空
- MiniMax API 不提供结果数限制参数，返回全部结果由客户端消费
- 响应中 `organic` 数组为空时输出兜底文本
