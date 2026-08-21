# Media

Media 是 ToBe 的双向媒体能力。v0.2.0 统一了图片与音频的存储、分析、生成和引用，并为视频与普通文件保留类型扩展点。

## 稳定边界

- Agent 只接触 `MediaRef`，不会获得二进制、本地路径、API Key 或临时下载地址。
- Adapter 只负责平台侧下载、解密、上传和发送协议，并以 `MediaMetadata` 与 Pipeline 交换原始媒体。
- Awareness Engine 所属的 Media Pipeline 是唯一转换层：入站存储并分析，出站解析引用。
- Adapter 不导入或调用 Media Service；Media 未启用时，普通文本能力仍然可用。

```text
入站：Environment → Adapter(MediaMetadata) → Engine → Media Pipeline → MediaRef → Agent
出站：Agent(MediaRef) → awareness_interact → Engine → Media Pipeline → Media.resolve → MediaMetadata → Adapter
```

## Agent 工具

只公开三个工具：

- `media_list`：列出 `media/lib` 中真实存在的 category/tag。
- `media_analyze`：一次分析一到八个 MediaRef 或工作区文件；多张图片在同一次模型上下文中传递。
- `media_generate`：通过 prompt 和最多四个引用生成图片或音频，成功后只返回 artifact MediaRef。

`resolve`、存储、导入等均为内部 API，不注册为 Agent Tool。

## 引用格式

artifact 引用使用 12 位 ID：

```json
{ "type": "media_ref", "source": "artifact", "kind": "image", "id": "20260821-ab-", "description": "生成的图片" }
```

library 引用使用 category/tag：

```json
{ "type": "media_ref", "source": "library", "kind": "image", "category": "stickers", "tag": "开心", "description": "开心表情" }
```

两种结构严格互斥，不允许混合 `id` 与 `category/tag`。

## 文件布局

```text
media/
  data/<kind>/<12-char-id><description>.<ext>
  lib/<kind>/<category>/<tag>/<file>
```

`data` 保存入站和生成的运行资产，`lib` 保存人工维护的固定资产。磁盘是事实来源，不维护内存 Artifact Registry。模型返回的完整分析结果不持久化，仅在 MediaRef 中保留必要描述。

## Provider

`config.default.json` 首次加载时复制为不受 Git 跟踪的 `config.json`。图片识别、音频识别、图片生成和音频生成分别配置。图片参考生成使用 `referenceEndpoint`，默认是 OpenAI-compatible 的 `/v1/images/edits` multipart 接口。

当前模型层只承诺图片和音频分析/生成。模型请求受超时、响应大小和允许下载主机限制；媒体库解析拒绝路径穿越和符号链接逃逸。

## v0.2.0 已知限制

- 不自动清理 `media/data`。
- 不提供 artifact 晋升 library。
- ID 冲突直接覆盖，不做复杂去重或重试。
- 不持久化完整分析结果。
- 视频与普通文件不承诺模型处理能力。
