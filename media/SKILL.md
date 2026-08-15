---
name: tobe-media
description: 使用 ToBe Media 的图片/音频识别、媒体库检索和生成能力，并把结果交给 Awareness Adapter 发送。
---

# Media

Media 是独立的双向媒体能力。它不会把媒体伪装成普通文本：入站识别结果必须同时保留媒体类型描述与文本解释；出站媒体必须经 Adapter 转为目标平台格式。

## 检索型媒体

1. 调用 `media_list` 获取当前真实存在的 library、category、revision。
2. 从结果中选择，不得编造目录名。
3. 调用 `awareness_interact` 的 Adapter 媒体动作，传入：

```json
{ "media": { "source": "library", "library": "stickers", "category": "开心", "selection": "random", "revision": "..." } }
```

## 生成型媒体

1. 调用 `media_generate`，`kind` 当前为 `image` 或 `audio`，`text` 是提示词或要合成的语音文本。
2. 检查结果 `status`。成功后只使用返回的 `media.id`。
3. 调用目标 Adapter 媒体动作，传入：

```json
{ "media": { "source": "artifact", "mediaId": "media_..." } }
```

生成成功不代表发送成功；以 Adapter 对应 `awareness_interact` 的结果为最终环境回执。不要把 `mediaId` 当成可供用户访问的 URL。
