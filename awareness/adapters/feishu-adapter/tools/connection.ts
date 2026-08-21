import type { AdapterActionDefinition } from "../../../adapter.ts";

export const CONNECTION_ACTIONS = [
  { action: "connect", mode: "interact", description: "Open the Feishu connection and start receiving messages.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "disconnect", mode: "interact", description: "Stop receiving Feishu messages.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { action: "status", mode: "observe", description: "Read the Feishu adapter and connection status.", parameters: { type: "object", properties: {}, additionalProperties: false } },
] as const satisfies readonly AdapterActionDefinition[];
