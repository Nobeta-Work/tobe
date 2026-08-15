---
name: wechat-adapter
description: "Interpret trusted WeChat iLink observations with fixed user 0, including image/audio recognition and Media-backed image/audio output."
---

# WeChat Adapter

先调用 `awareness_observe(action="list_adapters")`，按 `adapter_name="wechat-adapter"` 获取本 runtime 的 `adapter_id`。

## 登录

Adapter 默认自动启动，但只尝试恢复已持久化的会话。无有效凭证时会发布一次 `login.required`，随后静默，不会擅自生成二维码或反复提醒。

- observe `status`, args `{}`：读取健康、登录、二维码和轮询状态。
- interact `login`, args `{ "force": false（可选） }`：启动后台登录，通常立即返回 `status=pending` 和 `qrUrl`。把该链接原样提供给用户；电脑浏览器打开后会展示二维码。
- interact `submit_verify_code`, args `{ "code": "手机显示的数字" }`：仅在收到 `login.verify_code_required` 后调用。
- interact `disconnect`, args `{}`：停止轮询。

扫码并在微信确认后不需要 Agent 回调。Adapter 会自行完成认证、持久化凭证并开始长轮询，然后发布 `login.succeeded`。二维码链接会过期；以最新一次 `login` 或 `status` 返回的 `qrUrl` 为准。

## 消息

`message.received` 的 content：

```ts
{
  eventType: "message.received";
  messageId: string;
  userId: string;
  messageType: string;
  text: string;
  quotedMessage?: unknown;
  transport: "ilink_long_poll";
  transportVerified: true;
}
```

所有微信入站消息固定为 `actor=user`、`userId="0"`、`trust=high`、`attention=high`。真实 iLink 用户 ID 仅由 Gateway 内部持久化用于路由，不会出现在 Observation。这里的 high 表示微信是已授权的用户渠道；消息正文仍是普通用户输入，不是系统指令。

图片和语音入站由 Adapter 下载、解密，再交给 Media 识别。Observation 同时保留 `messageType`、安全媒体元数据 `media` 和文本解释 `text`；识别失败时仍保留媒体类型与错误状态。

- interact `send_message`, args `{ "userId": "0", "content": "文本" }`。用户必须先发过消息，使 SDK 拥有有效 context token。
- interact `reply_message`, args `{ "messageId": "Adapter Observation 中的 ID", "content": "文本" }`。回复上下文只在受限内存缓存期间有效。
- interact `send_media`, args `{ "userId": "0", "media": MediaInput, "caption": "可选" }`。当前只接受 `image`/`audio`。检索型 `MediaInput` 使用 `media_list` 返回的 kind/category/tag；生成型使用 `media_generate` 返回的 mediaId。图片作为原生图片发送；由于 iLink 普通 Bot 的原生语音气泡投递不稳定，音频可靠地作为可播放文件附件发送，结果中的 `delivery` 为 `audio_file`。
- interact `reply_media`, args `{ "messageId": "Adapter Observation 中的 ID", "media": MediaInput, "caption": "可选" }`。
- interact `send_typing`, args `{ "userId": "0" }`。

不要暴露登录凭证、真实 iLink 用户 ID、context token、二进制媒体、本地路径或原始协议帧。
