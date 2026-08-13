import { randomUUID } from "node:crypto";
import type { FeishuConfig, FeishuReceiveIdType } from "../config.ts";
import type { FeishuGateway, SentFeishuMessage } from "./client.ts";

export interface SendMessageArgs {
  content: string;
  receiveId?: string;
  receiveIdType?: FeishuReceiveIdType;
  messageId?: string;
  replyInThread?: boolean;
}

export async function sendMessage(gateway: FeishuGateway, config: FeishuConfig, args: SendMessageArgs): Promise<{ messages: SentFeishuMessage[] }> {
  const sentences = splitMessage(args.content, config.send.splitMultiline);
  const messages: SentFeishuMessage[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (sentence === undefined) continue;
    if (index > 0 && config.send.typingDelay) await delay(typingDelay(sentence, config));
    const uuid = randomUUID();
    if (args.messageId) {
      messages.push(await gateway.replyText(args.messageId, sentence, args.replyInThread ?? config.send.replyInThread, uuid));
    } else {
      if (!args.receiveId) throw new Error("send_message requires receiveId when messageId is absent");
      messages.push(await gateway.sendText(args.receiveId, args.receiveIdType ?? config.send.defaultReceiveIdType, sentence, uuid));
    }
  }
  return { messages };
}

export function splitMessage(content: string, enabled: boolean): string[] {
  if (!enabled || !content.includes("\n")) return [content];
  const parts = content.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [content];
}

function typingDelay(content: string, config: FeishuConfig): number {
  return Math.min(config.send.baseDelayMs + content.length * config.send.perCharacterDelayMs, config.send.maxDelayMs);
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
