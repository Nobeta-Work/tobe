import type { IIroseEvent } from "./protocol.ts";

interface LocalResponse {
  messageId: string;
  content: string;
  expiresAt: number;
}

/** 仅抑制 Adapter 本地命令/插件响应被聊天室回显后再次送入 Engine。 */
export class LocalResponseGuard {
  readonly #ttlMs: number;
  readonly #responses: LocalResponse[] = [];

  constructor(ttlMs = 15_000) { this.#ttlMs = ttlMs; }

  remember(messageId: string, content: string, now = Date.now()): void {
    this.#prune(now);
    this.#responses.push({ messageId, content, expiresAt: now + this.#ttlMs });
  }

  consume(event: IIroseEvent, now = Date.now()): boolean {
    this.#prune(now);
    if (!event.type.startsWith("message.")) return false;
    const index = this.#responses.findIndex((response) =>
      event.messageId !== undefined && response.messageId === event.messageId,
    );
    if (index < 0) return false;
    this.#responses.splice(index, 1);
    return true;
  }

  #prune(now: number): void {
    for (let index = this.#responses.length - 1; index >= 0; index -= 1) {
      if ((this.#responses[index]?.expiresAt ?? 0) <= now) this.#responses.splice(index, 1);
    }
  }
}
