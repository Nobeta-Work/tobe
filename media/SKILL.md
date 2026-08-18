---
name: media
description: 使用 ToBe Media 的图片/音频识别、媒体库检索和生成能力，并把结果交给 Awareness Adapter 发送。
---

# Media

Media 是独立的双向媒体能力。它不会把媒体伪装成普通文本：入站识别结果必须同时保留媒体类型描述与文本解释；出站媒体必须经 Adapter 转为目标平台格式。

如果收到、或者想查看图片、音频文件，请优先使用 Media 侧能力，而不要直接将图片、文件与二进制信息加入上下文！

## 检索型媒体

1. 以所需 `kind` 调用 `media_list`，获取当前真实存在的 category 和 tag。
2. 从结果中选择，不得编造目录名。
3. 调用 `awareness_interact` 的 Adapter 媒体动作，传入：

```json
{ "media": { "source": "library", "kind": "image", "category": "stickers", "tag": "开心", "selection": "random" } }
```

## 生成型媒体

1. 调用 `media_generate`，`kind` 当前为 `image` 或 `audio`，`text` 是提示词或要合成的语音文本。
2. 检查结果 `status`。成功后只使用返回的 `media.id`，例如 `image:20260816-8s-`；不得根据磁盘描述扩写或猜测 key。
3. 调用目标 Adapter 媒体动作，传入：

```json
{ "media": { "source": "artifact", "mediaId": "image:20260816-8s-" } }
```

生成成功不代表发送成功；以 Adapter 对应 `awareness_interact` 的结果为最终环境回执。不要把 `mediaId` 当成可供用户访问的 URL。

发送失败时复用同一 `mediaId` 重试，不要重复调用 `media_generate`。需要核对生成结果时可调用 `media_inspect({ "mediaId": "..." })`；它只返回安全元数据。

## 边界

- Agent 结果中不得暴露媒体二进制、本地路径、生成文件描述、API Key 或模型临时鉴权 URL。
- Adapter 必须向 Media 传入目标平台的类型、MIME、大小和动画等约束，并负责上传及最终协议。
- 当前只承诺 `image`/`audio` 识别和生成；不要把 `video`/`file` 描述成已有模型能力。
- 入站识别失败时保留原始媒体类型与错误状态，不得伪装成普通文本。
