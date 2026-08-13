import type { IIroseConfig } from "../config.ts";
import { parseIncomingFrame, type IIroseEvent } from "../protocol.ts";
import type { IIroseClient } from "./client.ts";

export function listen(
  client: IIroseClient,
  config: IIroseConfig,
  listener: (event: IIroseEvent) => void | Promise<void>,
): () => void {
  return client.subscribe((frame) => {
    for (const event of parseIncomingFrame(frame, config.credentials.roomId)) void listener(event);
  });
}
