import type { Actor } from "../../type.ts";
import type { IIroseConfig } from "./config.ts";
import type { IIroseEvent } from "./protocol.ts";

/** IIROSE 当前可解码事件均有 UID；无 UID 的协议信号不会伪装成参与者。 */
export function classifyIIroseActor(event: IIroseEvent, config: IIroseConfig): Actor {
  if (event.userId === config.credentials.uid) return "assistant";
  if (config.adminsIds.includes(event.userId)) return "user";
  return "service";
}
