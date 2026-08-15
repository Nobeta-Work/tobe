import type { Level } from "../../../type.ts";

export type ActiveLevel = Exclude<Level, "max">;

export interface ActivePluginConfig {
  level: ActiveLevel;
  longWindowMs: number;
  shortWindowMs: number;
}

/** 基础触发后保持一段主动会话窗口；high 让每条公屏消息都触发。 */
export class ActivePlugin {
  #level: ActiveLevel;
  readonly #config: ActivePluginConfig;
  readonly #activeUntil = new Map<string, number>();

  constructor(config: ActivePluginConfig) { this.#config = config; this.#level = config.level; }
  get level(): ActiveLevel { return this.#level; }
  setLevel(level: ActiveLevel): void { this.#level = level; if (level === "off") this.#activeUntil.clear(); }

  shouldTrigger(source: string, baseTrigger: boolean, now = Date.now()): boolean {
    if (this.#level === "off") return baseTrigger;
    if (this.#level === "high") return true;
    const duration = this.#level === "low" ? this.#config.longWindowMs : this.#config.shortWindowMs;
    if (baseTrigger) this.#activeUntil.set(source, now + duration);
    return baseTrigger || now <= (this.#activeUntil.get(source) ?? 0);
  }
}
