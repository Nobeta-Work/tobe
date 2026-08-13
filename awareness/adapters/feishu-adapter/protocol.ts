import { randomUUID } from "node:crypto";

export interface FeishuIdSet { open_id?: string; user_id?: string; union_id?: string }
export interface FeishuMention { key: string; id: FeishuIdSet; name: string; mentioned_type?: string; tenant_key?: string }

export interface FeishuMessageEvent {
  event_id?: string;
  create_time?: string;
  tenant_key?: string;
  app_id?: string;
  sender: {
    sender_id?: FeishuIdSet;
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    thread_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: FeishuMention[];
  };
}

export interface ParsedFeishuContent {
  text?: string;
  raw: unknown;
}

export function parseMessageContent(messageType: string, content: string): ParsedFeishuContent {
  let raw: unknown;
  try { raw = JSON.parse(content) as unknown; }
  catch { return { text: content, raw: content }; }
  if (!raw || typeof raw !== "object") return { raw };
  const object = raw as Record<string, unknown>;
  if (typeof object.text === "string") return { text: object.text, raw };
  if (messageType === "post") {
    const text = collectPostText(object);
    return text ? { text, raw } : { raw };
  }
  return { raw };
}

function collectPostText(post: Record<string, unknown>): string {
  const blocks: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (typeof object.text === "string") blocks.push(object.text);
    for (const child of Object.values(object)) visit(child);
  };
  visit(post.content ?? post);
  return blocks.join("\n").trim();
}

export function observationId(event: FeishuMessageEvent): string {
  return event.event_id || event.message.message_id || randomUUID();
}

export function eventTimestamp(event: FeishuMessageEvent): number {
  const value = Number(event.message.create_time || event.create_time);
  if (!Number.isFinite(value)) return Date.now();
  return value < 10_000_000_000 ? value * 1_000 : value;
}
