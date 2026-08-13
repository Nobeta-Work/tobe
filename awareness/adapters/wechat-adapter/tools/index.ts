import type { AdapterActionDefinition } from "../../../adapter.ts";

export const WECHAT_ACTIONS = [
  { action: "status", mode: "observe", description: "查看微信适配器、登录和长轮询状态。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "login", mode: "interact", description: "显式拉起微信扫码登录并立即返回二维码网页链接。", parameters: { type: "object", properties: { force: { type: "boolean" } }, additionalProperties: false } },
  { action: "submit_verify_code", mode: "interact", description: "提交微信在配对挑战中显示的数字验证码。", parameters: { type: "object", required: ["code"], properties: { code: { type: "string" } }, additionalProperties: false } },
  { action: "disconnect", mode: "interact", description: "停止微信消息轮询。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "send_message", mode: "interact", description: "向已有会话上下文的微信用户发送文本。", parameters: { type: "object", required: ["userId", "content"], properties: { userId: { type: "string" }, content: { type: "string" } }, additionalProperties: false } },
  { action: "reply_message", mode: "interact", description: "回复适配器收到并仍在缓存中的微信消息。", parameters: { type: "object", required: ["messageId", "content"], properties: { messageId: { type: "string" }, content: { type: "string" } }, additionalProperties: false } },
  { action: "send_typing", mode: "interact", description: "向微信用户显示正在输入状态。", parameters: { type: "object", required: ["userId"], properties: { userId: { type: "string" } }, additionalProperties: false } },
] as const satisfies readonly AdapterActionDefinition[];
