import type { IIroseClient } from "./client.ts";

export async function switchRoom(client: IIroseClient, roomId: string, password?: string): Promise<void> {
  const target = roomId.trim();
  if (!target || target.includes(">")) throw new Error("roomId must be a non-empty IIROSE room ID");
  await client.send(`m${target}${password ? `>${password}` : ""}`);
}

export async function likeUser(client: IIroseClient, userId: string, message = ""): Promise<void> {
  const uid = userId.trim();
  if (!uid || /\s/.test(uid)) throw new Error("userId must be a non-empty IIROSE UID");
  await client.send(`+*${uid}${message.trim() ? ` ${message.trim()}` : ""}`);
}
