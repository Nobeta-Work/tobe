import type { FeishuGateway } from "./client.ts";
import type { FeishuMessageEvent } from "../protocol.ts";

export async function listen(gateway: FeishuGateway, onMessage: (event: FeishuMessageEvent) => void | Promise<void>): Promise<void> {
  await gateway.connect(onMessage);
}
