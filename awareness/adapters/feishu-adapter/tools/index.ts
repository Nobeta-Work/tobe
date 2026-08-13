import { CONNECTION_ACTIONS } from "./connection.ts";
import { MESSAGE_ACTIONS } from "./message.ts";

export const FEISHU_ACTIONS = [...CONNECTION_ACTIONS, ...MESSAGE_ACTIONS] as const;
