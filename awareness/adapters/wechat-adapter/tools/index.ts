import type { AdapterActionDefinition } from "../../../adapter.ts";

export const WECHAT_ACTIONS = [
  { action: "status", mode: "observe", description: "Inspect WeChat login, polling, and adapter health.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "login", mode: "interact", description: "Start an explicit WeChat QR login flow and return the QR page URL.", parameters: { type: "object", properties: { force: { type: "boolean" } }, additionalProperties: false } },
  { action: "submit_verify_code", mode: "interact", description: "Submit the numeric verification code shown during WeChat pairing.", parameters: { type: "object", required: ["code"], properties: { code: { type: "string" } }, additionalProperties: false } },
  { action: "disconnect", mode: "interact", description: "Stop WeChat message polling.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "send_message", mode: "interact", description: "Send text to the established conversation with public WeChat user 0.", parameters: { type: "object", required: ["userId", "content"], properties: { userId: { const: "0" }, content: { type: "string" } }, additionalProperties: false } },
  { action: "reply_message", mode: "interact", description: "Reply to a received WeChat message while its reply context remains cached.", parameters: { type: "object", required: ["messageId", "content"], properties: { messageId: { type: "string" }, content: { type: "string" } }, additionalProperties: false } },
  { action: "send_media", mode: "interact", description: "Send an image or audio MediaRef to public WeChat user 0; audio uses the native voice-message protocol.", parameters: { type: "object", required: ["userId", "media"], properties: { userId: { const: "0" }, media: mediaRefSchema(), caption: { type: "string" } }, additionalProperties: false } },
  { action: "reply_media", mode: "interact", description: "Reply to a cached WeChat message with an image or audio MediaRef.", parameters: { type: "object", required: ["messageId", "media"], properties: { messageId: { type: "string" }, media: mediaRefSchema(), caption: { type: "string" } }, additionalProperties: false } },
  { action: "send_typing", mode: "interact", description: "Show a typing indicator to public WeChat user 0.", parameters: { type: "object", required: ["userId"], properties: { userId: { const: "0" } }, additionalProperties: false } },
] as const satisfies readonly AdapterActionDefinition[];

function mediaRefSchema() {
  return {
    oneOf: [
      { type: "object", required: ["type", "source", "kind", "id", "description"], properties: { type: { const: "media_ref" }, source: { const: "artifact" }, kind: { enum: ["image", "audio"] }, id: { type: "string" }, description: { type: "string" } }, additionalProperties: false },
      { type: "object", required: ["type", "source", "kind", "category", "tag", "description"], properties: { type: { const: "media_ref" }, source: { const: "library" }, kind: { enum: ["image", "audio"] }, category: { type: "string" }, tag: { type: "string" }, description: { type: "string" } }, additionalProperties: false },
    ],
  };
}
