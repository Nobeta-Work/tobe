import type { AdapterActionDefinition } from "../../../adapter.ts";

export const BASIC_ACTIONS: readonly AdapterActionDefinition[] = [
  {
    action: "send_message",
    mode: "interact",
    description: "发送公屏文本；传 userId 时发送私聊。",
    parameters: { content: "non-empty string, required", userId: "string, optional" },
  },
  { action: "logs", mode: "observe", description: "读取 Adapter 日志状态；持久日志尚未实现。", parameters: {} },
];
