import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadMediaConfig } from "./config.ts";
import { Media } from "./media.ts";
import { registerMediaTools } from "./tools/index.ts";
import type { MediaService } from "./type.ts";

export * from "./type.ts";
export { Media, isMediaMetadata, isMediaRef, mediaErrorResult, parseMediaRef } from "./media.ts";

const MEDIA_SLOT = Symbol.for("@nobeta-work/tobe/media-service/v1");

interface ActiveMediaSlot { service: MediaService }

function mediaRegistry(): Record<PropertyKey, unknown> {
  return globalThis as Record<PropertyKey, unknown>;
}

function activeMediaSlot(): ActiveMediaSlot | undefined {
  return mediaRegistry()[MEDIA_SLOT] as ActiveMediaSlot | undefined;
}

export function getMedia(): MediaService | undefined { return activeMediaSlot()?.service; }

export default function mediaExtension(pi: ExtensionAPI): void {
  const config = loadMediaConfig();
  if (!config.enabled) return;
  installMediaExtension(pi, new Media(config));
}

/** Separate installation seam keeps the Pi lifecycle testable and providers replaceable. */
export function installMediaExtension(pi: ExtensionAPI, service: MediaService): void {
  if (activeMediaSlot()) throw new Error("Media is already installed");
  const slot: ActiveMediaSlot = { service };
  mediaRegistry()[MEDIA_SLOT] = slot;
  registerMediaTools(pi, service);

  pi.on("resources_discover", () => ({
    skillPaths: [fileURLToPath(new URL("./SKILL.md", import.meta.url))],
  }));
  pi.on("session_shutdown", () => {
    if (activeMediaSlot() === slot) delete mediaRegistry()[MEDIA_SLOT];
  });
}
