import type { AdapterActionDefinition } from "../../../adapter.ts";

export const BASIC_ACTIONS: readonly AdapterActionDefinition[] = [
  {
    action: "send_message",
    mode: "interact",
    description: "发送公屏文本；传 userId 时发送私聊。",
    parameters: { content: "non-empty string, required", userId: "string, optional" },
  },
  {
    action: "send_media", mode: "interact",
    description: "解析 Media 图片/音频并发送到当前房间；音频上传后直接发送返回的 MP3 URL。",
    parameters: {
      media: "MediaInput, required (artifact mediaId or library kind/category/tag)",
      caption: "string, optional",
    },
  },
  { action: "logs", mode: "observe", description: "读取当月消息日志状态。", parameters: {} },
  {
    action: "history", mode: "observe",
    description: "从当月日志按距最新消息的 1-based 闭区间读取历史；例如 start=11,end=20 返回更早十条。",
    parameters: { start: "positive integer, required", end: "positive integer, required; maximum 100 entries" },
  },
  {
    action: "set_active", mode: "interact", description: "切换主动响应等级。",
    parameters: { level: "off | low | medium | high, required" },
  },
];
