import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadMediaConfig } from "./config.ts";
import { Media } from "./media.ts";
import { registerMediaTools } from "./tools/index.ts";
import type { MediaService } from "./type.ts";

export * from "./type.ts";
export { Media, mediaErrorResult, parseMediaInput } from "./media.ts";

let activeMedia: MediaService | undefined;

export function getMedia(): MediaService | undefined { return activeMedia; }

export default function mediaExtension(pi: ExtensionAPI): void {
  const config = loadMediaConfig();
  if (!config.enabled) return;
  installMediaExtension(pi, new Media(config));
}

/** Separate installation seam keeps the Pi lifecycle testable and providers replaceable. */
export function installMediaExtension(pi: ExtensionAPI, service: MediaService): void {
  if (activeMedia) throw new Error("Media is already installed");
  activeMedia = service;
  registerMediaTools(pi, service);

  pi.on("resources_discover", () => ({
    skillPaths: [fileURLToPath(new URL("./SKILL.md", import.meta.url))],
  }));
  pi.on("session_shutdown", () => { if (activeMedia === service) activeMedia = undefined; });
}
