import type { IIroseConfig } from "../config.ts";
import type { IIroseEvent } from "../protocol.ts";

export interface AdapterPluginResult {
  handled: boolean;
  response?: { content: string; userId?: string };
}

/** 确定性白名单插件：不调用模型，具备按用户和全局两层防刷。 */
export class WelcomePlugin {
  readonly name = "welcome";
  readonly #config: IIroseConfig["plugins"]["welcome"];
  readonly #selfUserId: string;
  readonly #lastByUser = new Map<string, number>();
  #globalSends: number[] = [];

  constructor(config: IIroseConfig["plugins"]["welcome"], selfUserId: string) {
    this.#config = config;
    this.#selfUserId = selfUserId;
  }

  handle(event: IIroseEvent, now = Date.now()): AdapterPluginResult {
    if (!this.#config.enabled || event.type !== "member.join") return { handled: false };
    // 自身上线也会收到 member.join。直接消费，既不欢迎自己，也不继续推给 Agent。
    if (event.userId === this.#selfUserId) return { handled: true };
    const last = this.#lastByUser.get(event.userId);
    if (last !== undefined && now - last < this.#config.perUserCooldownMs) return { handled: true };
    this.#globalSends = this.#globalSends.filter((at) => now - at <= this.#config.globalWindowMs);
    if (this.#globalSends.length >= this.#config.globalMaxMessages) return { handled: true };
    this.#lastByUser.set(event.userId, now);
    this.#globalSends.push(now);
    return {
      handled: true,
      response: { content: this.#config.template.replaceAll("{name}", event.username) },
    };
  }
}
