import type { Level } from "../../type.ts";
import type { FeishuConfig } from "./config.ts";

interface Sample { at: number; owner: boolean }

export class FeishuParticipationClassifier {
  readonly #windows = new Map<string, Sample[]>();
  readonly #config: FeishuConfig["assessment"];

  constructor(config: FeishuConfig["assessment"]) { this.#config = config; }

  assess(source: string, owner: boolean, mentioned: boolean, direct: boolean, now = Date.now()): { trust: Level; attention: Level } {
    const samples = this.#windows.get(source) ?? [];
    samples.push({ at: now, owner });
    const retained = samples
      .filter((sample) => now - sample.at <= this.#config.windowMs)
      .slice(-this.#config.maxEventsPerWindow);
    this.#windows.set(source, retained);
    const owners = retained.filter((sample) => sample.owner).length;
    const recent = retained.filter((sample) => now - sample.at <= this.#config.floodWindowMs).length;
    let trust: Level;
    if (owners === 0 && recent > this.#config.floodThreshold) trust = "off";
    else if (owners === 0) trust = "low";
    else if (owners === retained.length) trust = "high";
    else trust = "medium";
    if (trust === "off") return { trust, attention: "off" };
    let attention: Level;
    if (owner && (direct || mentioned)) attention = "high";
    else if (owner) attention = "medium";
    else if (mentioned || direct) attention = "medium";
    else attention = "off";
    return { trust, attention };
  }
}
