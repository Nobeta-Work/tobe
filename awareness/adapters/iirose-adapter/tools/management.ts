import type { AdapterActionDefinition } from "../../../adapter.ts";

/** 房间与后续黑名单、禁言等管理操作集中在此类别。 */
export const MANAGEMENT_ACTIONS: readonly AdapterActionDefinition[] = [
  { action: "switch_room", mode: "interact", description: "切换机器人所在 IIROSE 房间。", parameters: { roomId: "non-empty string, required", password: "string, optional" } },
  { action: "set_follow", mode: "interact", description: "设置是否跟随管理员切换房间。", parameters: { follow: "boolean, required" } },
];
