import type { Actor } from "../../type.ts";
import type { FeishuConfig } from "./config.ts";
import type { FeishuMessageEvent } from "./protocol.ts";

export function classifyFeishuActor(event: FeishuMessageEvent, config: FeishuConfig): Actor {
  const openId = event.sender.sender_id?.open_id;
  if (openId && config.identity.adminsIds.includes(openId)) return "user";
  if (event.sender.sender_type === "app" || event.sender.sender_type === "bot") return "assistant";
  if (openId && openId === config.identity.botOpenId) return "assistant";
  return "service";
}
