import type { MediaConfig } from "../config.ts";
import type { MediaModels } from "../type.ts";
import { HttpMediaModels } from "./http.ts";

export function createMediaModels(config: MediaConfig): MediaModels {
  return new HttpMediaModels(config);
}

export { HttpMediaModels } from "./http.ts";
