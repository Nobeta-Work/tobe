import type { AdapterActionDefinition } from "../../../adapter.ts";

export const CONNECTION_ACTIONS = [
  { action: "connect", mode: "interact", description: "建立飞书长连接并开始接收消息。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "disconnect", mode: "interact", description: "停止飞书消息监听。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "status", mode: "observe", description: "查看飞书 adapter 和长连接状态。", parameters: { type: "object", properties: {}, additionalProperties: false } },
] as const satisfies readonly AdapterActionDefinition[];
