import type { AdapterActionDefinition } from "../../../adapter.ts";

export const MESSAGE_ACTIONS = [
  {
    action: "send_message", mode: "interact", description: "向飞书用户或群聊发送文本消息。",
    parameters: {
      type: "object", required: ["content", "receiveId"], additionalProperties: false,
      properties: {
        content: { type: "string" }, receiveId: { type: "string" },
        receiveIdType: { type: "string", enum: ["open_id", "user_id", "union_id", "email", "chat_id"] },
      },
    },
  },
  {
    action: "reply_message", mode: "interact", description: "回复指定飞书消息，可在线程内回复。",
    parameters: {
      type: "object", required: ["content", "messageId"], additionalProperties: false,
      properties: { content: { type: "string" }, messageId: { type: "string" }, replyInThread: { type: "boolean" } },
    },
  },
] as const satisfies readonly AdapterActionDefinition[];
