import type { AdapterActionDefinition } from "../../../adapter.ts";

export const WECHAT_ACTIONS = [
  { action: "status", mode: "observe", description: "查看微信适配器、登录和长轮询状态。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "login", mode: "interact", description: "显式拉起微信扫码登录并立即返回二维码网页链接。", parameters: { type: "object", properties: { force: { type: "boolean" } }, additionalProperties: false } },
  { action: "submit_verify_code", mode: "interact", description: "提交微信在配对挑战中显示的数字验证码。", parameters: { type: "object", required: ["code"], properties: { code: { type: "string" } }, additionalProperties: false } },
  { action: "disconnect", mode: "interact", description: "停止微信消息轮询。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "send_message", mode: "interact", description: "向固定微信用户 0 的已有会话发送文本。", parameters: { type: "object", required: ["userId", "content"], properties: { userId: { const: "0" }, content: { type: "string" } }, additionalProperties: false } },
  { action: "reply_message", mode: "interact", description: "回复适配器收到并仍在缓存中的微信消息。", parameters: { type: "object", required: ["messageId", "content"], properties: { messageId: { type: "string" }, content: { type: "string" } }, additionalProperties: false } },
  { action: "send_media", mode: "interact", description: "解析 Media 图片/音频输入并发送给固定微信用户 0；音频以附件交付。", parameters: { type: "object", required: ["userId", "media"], properties: { userId: { const: "0" }, media: mediaInputSchema(), caption: { type: "string" } }, additionalProperties: false } },
  { action: "reply_media", mode: "interact", description: "解析 Media library/artifact 输入并回复仍在缓存中的微信消息。", parameters: { type: "object", required: ["messageId", "media"], properties: { messageId: { type: "string" }, media: mediaInputSchema(), caption: { type: "string" } }, additionalProperties: false } },
  { action: "send_typing", mode: "interact", description: "向固定微信用户 0 显示正在输入状态。", parameters: { type: "object", required: ["userId"], properties: { userId: { const: "0" } }, additionalProperties: false } },
] as const satisfies readonly AdapterActionDefinition[];

function mediaInputSchema() {
  return {
    oneOf: [
      { type: "object", required: ["source", "mediaId"], properties: { source: { const: "artifact" }, mediaId: { type: "string" } }, additionalProperties: false },
      { type: "object", required: ["source", "kind", "category", "tag"], properties: { source: { const: "library" }, kind: { enum: ["image", "audio"] }, category: { type: "string" }, tag: { type: "string" }, selection: { enum: ["random", "best"] } }, additionalProperties: false },
    ],
  };
}
