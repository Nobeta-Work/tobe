import { createHash, randomUUID } from "node:crypto";

export type WeChatMessageType = "text" | "image" | "voice" | "file" | "video" | string;

export interface WeChatIncomingMessage {
  userId: string;
  text: string;
  type: WeChatMessageType;
  timestamp: Date;
  images?: readonly unknown[];
  voices?: readonly unknown[];
  files?: readonly { fileName?: string; size?: number }[];
  videos?: readonly unknown[];
  quotedMessage?: { title?: string; text?: string; type?: string };
  raw?: unknown;
}

export function messageFingerprint(message: WeChatIncomingMessage): string {
  const raw = JSON.stringify(message.raw ?? null);
  if (raw !== "null" && raw !== "{}") return createHash("sha256").update(raw).digest("hex").slice(0, 24);
  return createHash("sha256").update(`${message.userId}\0${message.timestamp.getTime()}\0${message.type}\0${message.text}`).digest("hex").slice(0, 24);
}

export function publicMessageId(message: WeChatIncomingMessage): string {
  const raw = message.raw;
  if (raw && typeof raw === "object") {
    for (const key of ["message_id", "messageId", "msg_id", "msgId", "id"]) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return value;
      if (typeof value === "number") return String(value);
    }
  }
  return randomUUID();
}
