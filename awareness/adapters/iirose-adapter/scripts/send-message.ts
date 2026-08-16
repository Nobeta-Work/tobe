import type { IIroseConfig } from "../config.ts";
import { createMessageFrame } from "../protocol.ts";
import type { IIroseClient } from "./client.ts";

export interface SendMessageArgs { content: string; userId?: string }

export async function sendMessage(client: Pick<IIroseClient, "send">, config: IIroseConfig, args: SendMessageArgs) {
  const encoded = createMessageFrame(args.content, config.profile.messageColor, args.userId);
  await client.send(encoded.frame);
  return { messageId: encoded.messageId, channel: args.userId ? `private:${args.userId}` : config.credentials.roomId };
}
