import type { Level } from "../../type.ts";
export interface ParticipationMessage { isAdmin: boolean }
interface LegacyConfig { windowMs: number; floodWindowMs: number; floodThreshold: number; maxEventsPerWindow: number }
interface LegacySample { at: number; admin: boolean }

/** 等级只取决于触发方式与最近十条消息；IIROSE 永远不会产生 max。 */
export class ParticipationClassifier {
  readonly #legacyConfig: LegacyConfig | undefined;
  readonly #legacyWindows = new Map<string, LegacySample[]>();

  constructor(legacyConfig?: LegacyConfig) { this.#legacyConfig = legacyConfig; }

  assess(history: readonly ParticipationMessage[], options: { triggered: boolean; private: boolean; isAdmin: boolean }): { trust: Level; attention: Level };
  /** @deprecated 兼容旧调用方；新 Adapter 不再使用时间/洪泛窗口。 */
  assess(source: string, isAdmin: boolean, now?: number): { trust: Level; attention: Level };
  assess(
    historyOrSource: readonly ParticipationMessage[] | string,
    optionsOrAdmin: { triggered: boolean; private: boolean; isAdmin: boolean } | boolean,
    now = Date.now(),
  ): { trust: Level; attention: Level } {
    if (typeof historyOrSource === "string") return this.#legacyAssess(historyOrSource, optionsOrAdmin === true, now);
    const history = historyOrSource;
    const options = optionsOrAdmin as { triggered: boolean; private: boolean; isAdmin: boolean };
    if (options.private) {
      const level: Level = options.isAdmin ? "high" : "off";
      return { trust: level, attention: level };
    }
    if (!options.triggered) return { trust: "off", attention: "off" };
    const window = history.slice(-10);
    const adminCount = window.filter((message) => message.isAdmin).length;
    const level: Level = adminCount === 0 ? "low" : adminCount === window.length ? "high" : "medium";
    return { trust: level, attention: level };
  }

  #legacyAssess(source: string, isAdmin: boolean, now: number): { trust: Level; attention: Level } {
    const config = this.#legacyConfig ?? { windowMs: 60_000, floodWindowMs: 5_000, floodThreshold: 12, maxEventsPerWindow: 200 };
    const samples = this.#legacyWindows.get(source) ?? [];
    samples.push({ at: now, admin: isAdmin });
    const retained = samples.filter((sample) => now - sample.at <= config.windowMs).slice(-config.maxEventsPerWindow);
    this.#legacyWindows.set(source, retained);
    const admins = retained.filter((sample) => sample.admin).length;
    const recent = retained.filter((sample) => now - sample.at <= config.floodWindowMs).length;
    const level: Level = admins === 0 && recent > config.floodThreshold ? "off"
      : admins === 0 ? "low" : admins === retained.length ? "high" : "medium";
    return { trust: level, attention: level };
  }
}

export function directlyAddressesBot(content: string, username: string, nickname: string, reply = false): boolean {
  if (reply) return true;
  const normalized = content.trim();
  if (username && (normalized.includes(`[*${username}*]`) || normalized.includes(`@${username}`))) return true;
  return Boolean(nickname && normalized.includes(nickname));
}
