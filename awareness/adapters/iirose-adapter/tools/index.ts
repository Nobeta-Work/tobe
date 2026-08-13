import { ACCOUNT_ACTIONS } from "./account.ts";
import { BASIC_ACTIONS } from "./basic.ts";
import { MANAGEMENT_ACTIONS } from "./management.ts";
import { SOCIAL_ACTIONS } from "./social.ts";
import { MUSIC_ACTIONS } from "./music.ts";

export const IIROSE_ACTIONS = [
  ...ACCOUNT_ACTIONS,
  ...BASIC_ACTIONS,
  ...MUSIC_ACTIONS,
  ...SOCIAL_ACTIONS,
  ...MANAGEMENT_ACTIONS,
] as const;
