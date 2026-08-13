import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { IIroseConfig } from "./config.ts";

export interface IIroseEvent {
  type: "message.public" | "message.private" | "member.join" | "member.leave";
  timestamp: number;
  userId: string;
  username: string;
  roomId?: string;
  messageId?: string;
  content: string;
  raw: string;
}

const entities: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x2F;": "/",
};

export function decodeEntities(input: string): string {
  let output = input;
  let previous = "";
  while (previous !== output) {
    previous = output;
    output = output.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#x2F;/g, (entity) => entities[entity] ?? entity);
  }
  return output;
}

export function createLoginFrame(config: IIroseConfig): string {
  const { username, password, roomId, roomPassword } = config.credentials;
  if (!username || !password || !roomId) {
    throw new Error("credentials.username, password and roomId are required to login");
  }
  const md5 = (text: string) => createHash("md5").update(text).digest("hex");
  const hashedPassword = /^[a-f0-9]{32}$/.test(password) ? password : md5(password);
  return `*${JSON.stringify({
    r: roomId,
    n: username,
    p: hashedPassword,
    st: config.profile.status,
    mo: config.profile.signature,
    mb: "",
    mu: "01",
    rp: roomPassword || undefined,
    fp: `@${md5(username)}`,
  })}`;
}

export function createMessageFrame(content: string, color: string, userId?: string) {
  if (!content.trim()) throw new Error("Message content cannot be empty");
  const messageId = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
  return {
    messageId,
    frame: JSON.stringify({ ...(userId ? { g: userId } : {}), m: content, mc: color, i: messageId }),
  };
}

export function encodeWireFrame(frame: string): ArrayBuffer {
  const utf8 = Buffer.from(frame);
  const bytes = utf8.length > 256 ? Buffer.concat([Buffer.from([1]), gzipSync(utf8)]) : utf8;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function decodeWireFrame(data: string | Blob | ArrayBuffer | ArrayBufferView): Promise<string> {
  if (typeof data === "string") return data;
  const bytes = data instanceof Blob
    ? new Uint8Array(await data.arrayBuffer())
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
  return bytes[0] === 1 ? gunzipSync(bytes.subarray(1)).toString("utf8") : Buffer.from(bytes).toString("utf8");
}

export function loginFailure(frame: string): string | null {
  const failures: Record<string, string> = {
    '%*"0': "username is occupied",
    '%*"1': "username does not exist",
    '%*"2': "invalid password",
    '%*"4': "daily login attempt limit reached",
    '%*"5': "invalid room password",
    '%*"x': "user is banned",
    '%*"n0': "room cannot be entered",
  };
  return Object.entries(failures).find(([prefix]) => frame.startsWith(prefix))?.[1] ?? null;
}

export function parseIncomingFrame(raw: string, defaultRoomId: string): IIroseEvent[] {
  const privateEvent = parsePrivateMessage(raw);
  if (privateEvent) return [privateEvent];
  const event = parseSingle(raw, defaultRoomId);
  if (event) return [event];

  // 历史批量帧以 < 拼接；逐段恢复开头的 " 后再复用单帧解析器。
  if (raw.includes("<")) {
    return raw.split("<").flatMap((part, index) => {
      const candidate = index === 0 || part.startsWith('"') ? part : `"${part}`;
      const parsed = parseSingle(candidate, defaultRoomId);
      return parsed ? [parsed] : [];
    });
  }
  return [];
}

function parseSingle(raw: string, defaultRoomId: string): IIroseEvent | null {
  const parts = raw.split(">");
  if (!raw.startsWith('"') || parts.length < 10) return null;
  const timestamp = Number(parts[0]?.slice(1));
  if (!Number.isFinite(timestamp)) return null;
  const username = decodeEntities(parts[2] ?? "");
  const userId = parts[8] ?? "";
  if (!userId) return null;

  if (parts[3] === "'1") {
    return { type: "member.join", timestamp, username, userId, roomId: parts[10] || defaultRoomId, content: "joined the room", raw };
  }
  if (parts[3] === "'3" || parts[3]?.startsWith("'2")) {
    return { type: "member.leave", timestamp, username, userId, roomId: parts[10] || defaultRoomId, content: "left the room", raw };
  }
  if (parts.length === 11 && !raw.includes("<")) {
    const content = stripReply(decodeEntities(parts[3] ?? ""));
    if (content.startsWith("m__4@")) return null;
    return {
      type: "message.public", timestamp, username, userId, roomId: defaultRoomId,
      content, messageId: parts[10] as string, raw,
    };
  }
  return null;
}

function parsePrivateMessage(raw: string): IIroseEvent | null {
  if (!raw.startsWith('""')) return null;
  for (const item of raw.slice(2).split("<")) {
    const parts = item.split(">");
    if (parts.length !== 11 || !/^\d+$/.test(parts[0] ?? "")) continue;
    return {
      type: "message.private",
      timestamp: Number(parts[0] as string),
      userId: parts[1] as string,
      username: decodeEntities(parts[2] as string),
      content: stripReply(decodeEntities(parts[4] as string)),
      messageId: parts[10] as string,
      raw,
    };
  }
  return null;
}

function stripReply(content: string): string {
  if (!content.includes(" (_hr) ")) return content;
  return content.split(" (hr_) ").at(-1) ?? content;
}

export function eventId(): string {
  return randomUUID();
}
