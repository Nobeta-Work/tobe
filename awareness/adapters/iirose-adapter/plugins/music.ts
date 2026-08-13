import type { IIroseConfig } from "../config.ts";
import type { IIroseEvent } from "../protocol.ts";
import { matchPluginCommand } from "./commands.ts";

export type MusicPluginResult =
  | { handled: false }
  | { handled: true; songName?: string };

export class MusicPlugin {
  readonly name = "music";
  readonly #config: IIroseConfig;

  constructor(config: IIroseConfig) { this.#config = config; }

  handle(event: IIroseEvent, isAdmin: boolean): MusicPluginResult {
    if (!this.#config.plugins.music.enabled || !event.type.startsWith("message.")) return { handled: false };
    const match = matchPluginCommand(event.content, this.#config.plugins.music.commands, {
      username: this.#config.credentials.username,
      nickname: this.#config.nickname,
    });
    if (!match) return { handled: false };
    if (this.#config.plugins.music.commands.adminOnly && !isAdmin) return { handled: true };
    return match.args ? { handled: true, songName: match.args } : { handled: true };
  }
}
