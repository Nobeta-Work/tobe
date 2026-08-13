import type { Level } from "../../type.ts";
import type { IIroseConfig } from "./config.ts";

interface Sample { at: number; admin: boolean }

/** 按 source 维护滑动窗口；IIROSE 永远不会产生 max。 */
export class ParticipationClassifier {
  readonly #windows = new Map<string, Sample[]>();
  readonly #config: IIroseConfig["assessment"];

  constructor(config: IIroseConfig["assessment"]) {
    this.#config = config;
  }

  assess(source: string, isAdmin: boolean, now = Date.now()): { trust: Level; attention: Level } {
    const samples = this.#windows.get(source) ?? [];
    samples.push({ at: now, admin: isAdmin });
    const retained = samples
      .filter((sample) => now - sample.at <= this.#config.windowMs)
      .slice(-this.#config.maxEventsPerWindow);
    this.#windows.set(source, retained);

    const adminCount = retained.filter((sample) => sample.admin).length;
    const recentCount = retained.filter((sample) => now - sample.at <= this.#config.floodWindowMs).length;
    let level: Level;
    if (adminCount === 0 && recentCount > this.#config.floodThreshold) level = "off";
    else if (adminCount === 0) level = "low";
    else if (adminCount === retained.length) level = "high";
    else level = "medium";
    return { trust: level, attention: level };
  }
}
