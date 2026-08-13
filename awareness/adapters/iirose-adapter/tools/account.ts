import type { AdapterActionDefinition } from "../../../adapter.ts";

export const ACCOUNT_ACTIONS: readonly AdapterActionDefinition[] = [
  { action: "login", mode: "interact", description: "登录 IIROSE 并开始监听。", parameters: {} },
  { action: "logout", mode: "interact", description: "登出 IIROSE 并停止监听。", parameters: {} },
  { action: "status", mode: "observe", description: "读取账号连接状态。", parameters: {} },
];
