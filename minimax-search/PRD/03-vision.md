# 03 — 图片理解工具 `minimax_vision`

## API 契约

### 端点

```
POST {MINIMAX_API_HOST}/v1/coding_plan/vlm
Content-Type: application/json
Authorization: Bearer {MINIMAX_API_KEY}
```

### 请求

```json
{
  "prompt": "对图片的提问或分析要求",
  "image_url": "data:image/jpeg;base64,..."
}
```

`image_url` 字段接受三种输入源，在执行时必须统一转为 Base64 Data URL 格式：

| 输入类型 | 转换方式 |
|----------|----------|
| HTTPS URL (`https://...`) | 用 `fetch` 下载图片，读取 Content-Type 判断格式，转 base64 |
| 本地文件路径 (`/path/to/image.jpg`) | 用 `readFileSync` 读取，从扩展名判断格式，转 base64 |
| Base64 Data URL (`data:image/...`) | 透传不变 |

### 响应

```json
{
  "content": "模型对图片的分析文本",
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

## 工具定义

### 名称

`minimax_vision`

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | string | ✓ | 对图片的提问或分析要求 |
| `image_url` | string | ✓ | 图片来源，支持 HTTPS URL 或本地文件路径 |

### 输出

直接返回分析文本（`content` 字段内容）。

`details` 透传完整 `{ content }`。

## 图片支持规格

| 属性 | 值 |
|------|-----|
| 格式 | JPEG、PNG、GIF、WebP |
| 最大大小 | 20MB |
| 输入方式 | HTTPS URL / 本地路径 / Base64 Data URL |

## 错误处理

| 场景 | 行为 |
|------|------|
| `prompt` 或 `image_url` 为空 | 抛出参数校验错误 |
| 图片 URL 下载失败 | 抛出"Failed to download image from URL" |
| 本地文件不存在 | 抛出"Local image file does not exist" |
| 不支持的文件格式 | 抛出格式不支持错误 |
| API 返回 `content` 为空 | 抛出"No content returned from VLM API" |
| `base_resp.status_code` 非零 | 抛出对应错误消息 |

## 完整性要求

- 对 URL 和本地路径的图片下载/读取必须有错误回退（非破坏性）
- Base64 转换后的图片数据应控制大小（仅对图片内容编码，不额外增加开销）
- 不支持大文件流式处理，20MB 以内单次请求
