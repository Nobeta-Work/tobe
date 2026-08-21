import type { AdapterActionDefinition } from "../../../adapter.ts";

export const MESSAGE_ACTIONS = [
  {
    action: "send_message", mode: "interact", description: "Send a text message to a Feishu user or group chat.",
    parameters: {
      type: "object", required: ["content", "receiveId"], additionalProperties: false,
      properties: {
        content: { type: "string" }, receiveId: { type: "string" },
        receiveIdType: { type: "string", enum: ["open_id", "user_id", "union_id", "email", "chat_id"] },
      },
    },
  },
  {
    action: "reply_message", mode: "interact", description: "Reply to a Feishu message, optionally inside its thread.",
    parameters: {
      type: "object", required: ["content", "messageId"], additionalProperties: false,
      properties: { content: { type: "string" }, messageId: { type: "string" }, replyInThread: { type: "boolean" } },
    },
  },
] as const satisfies readonly AdapterActionDefinition[];
