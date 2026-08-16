import type { IIroseConfig } from "../config.ts";
import { createMessageFrame } from "../protocol.ts";
import type { IIroseClient } from "./client.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const CHAR_DELAY_MS = 50;

export interface SendMessageArgs { content: string; userId?: string }

export async function sendMessage(client: Pick<IIroseClient, "send">, config: IIroseConfig, args: SendMessageArgs) {
  
  const contents: string[] = args.content.split("\n").filter(line => line !== "");
  if (contents.length > 4) { return sendLinesMessage(client, config, args); }
  const encodedIds: string[] = [];
  for (let content of contents) {
    const length = content.length;
    await sleep(length * CHAR_DELAY_MS);
    const encoded = createMessageFrame(content, config.profile.messageColor, args.userId);
    await client.send(encoded.frame);
    encodedIds.push(encoded.messageId);
  }
  
  return { messageId: encodedIds.toString(), channel: args.userId ? `private:${args.userId}` : config.credentials.roomId };
}

export async function sendLinesMessage(client: Pick<IIroseClient, "send">, config: IIroseConfig, args: SendMessageArgs) {
  
  const encoded = createMessageFrame(args.content, config.profile.messageColor, args.userId);
  await client.send(encoded.frame);
  
  return { messageId: encoded.messageId, channel: args.userId ? `private:${args.userId}` : config.credentials.roomId };
}