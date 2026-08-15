import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { capabilities } from "../runtime/capabilities.ts";
import { loadMediaConfig } from "./config.ts";
import { MediaServiceImpl } from "./service.ts";
import { registerMediaTools } from "./tools.ts";
import { MEDIA_CAPABILITY } from "./type.ts";

export * from "./type.ts";
export * from "./errors.ts";
export { parseMediaInput } from "./input.ts";
export { MediaServiceImpl } from "./service.ts";

export default function mediaExtension(pi: ExtensionAPI): void {
  const config = loadMediaConfig();
  if (!config.enabled) return;
  const service = new MediaServiceImpl(config);
  const unregister = capabilities.provide(MEDIA_CAPABILITY, service);
  registerMediaTools(pi, service);

  pi.on("resources_discover", () => ({
    skillPaths: [fileURLToPath(new URL("./SKILL.md", import.meta.url))],
  }));
  pi.on("session_shutdown", unregister);
}
