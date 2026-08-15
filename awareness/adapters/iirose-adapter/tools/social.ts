import type { AdapterActionDefinition } from "../../../adapter.ts";

/** 点赞、关注等社交操作集中在此类别。 */
export const SOCIAL_ACTIONS: readonly AdapterActionDefinition[] = [
  { action: "like_user", mode: "interact", description: "点赞一个普通 IIROSE 用户。", parameters: { userId: "non-empty string, required", message: "string, optional" } },
];
