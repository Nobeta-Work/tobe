import type { AdapterActionDefinition } from "../../../adapter.ts";

export const ACCOUNT_ACTIONS: readonly AdapterActionDefinition[] = [
  { action: "login", mode: "interact", description: "Log in to IIROSE and start listening.", parameters: {} },
  { action: "logout", mode: "interact", description: "Log out of IIROSE and stop listening.", parameters: {} },
  { action: "status", mode: "observe", description: "Read the IIROSE account connection status.", parameters: {} },
];
