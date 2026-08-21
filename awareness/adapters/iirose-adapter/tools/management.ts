import type { AdapterActionDefinition } from "../../../adapter.ts";

/** 房间与后续黑名单、禁言等管理操作集中在此类别。 */
export const MANAGEMENT_ACTIONS: readonly AdapterActionDefinition[] = [
  { action: "switch_room", mode: "interact", description: "Move the agent to another IIROSE room.", parameters: { roomId: "non-empty string, required", password: "string, optional" } },
  { action: "set_follow", mode: "interact", description: "Set whether the agent follows the administrator between rooms.", parameters: { follow: "boolean, required" } },
];
