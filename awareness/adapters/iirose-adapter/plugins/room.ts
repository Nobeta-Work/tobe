export interface RoomPluginConfig { enabled: boolean; follow: boolean }

export class RoomPlugin {
  readonly enabled: boolean;
  #follow: boolean;
  constructor(config: RoomPluginConfig) { this.enabled = config.enabled; this.#follow = config.follow; }
  get follow(): boolean { return this.#follow; }
  setFollow(value: boolean): void { this.#follow = value; }
  shouldFollow(isAdmin: boolean): boolean { return this.enabled && this.#follow && isAdmin; }
}
