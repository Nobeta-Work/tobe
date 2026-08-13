import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { AwarenessEngineImpl } from "./engine/engine.ts";
import { discoverAdapters } from "./loader.ts";
import { subscribeAgentPush } from "./push.ts";
import { registerAwarenessTools } from "./tools/index.ts";

export * from "./type.ts";
export * from "./adapter.ts";
export { AwarenessEngineImpl } from "./engine/engine.ts";
export { discoverAdapters } from "./loader.ts";
export { subscribeAgentPush, pushObservation } from "./push.ts";

/** Pi extension 入口。Pi 负责调用；import 本文件本身不会启动网络连接。 */
export default async function awarenessExtension(pi: ExtensionAPI): Promise<void> {
  const engine = new AwarenessEngineImpl();
  const adapters = await discoverAdapters();
  for (const adapter of adapters) engine.register(adapter);

  registerAwarenessTools(pi, engine);
  const unsubscribePush = subscribeAgentPush(pi, engine);

  pi.on("resources_discover", () => ({
    skillPaths: [
      fileURLToPath(new URL("./SKILL.md", import.meta.url)),
      ...adapters.flatMap((adapter) => adapter.getSkillPaths()),
    ],
  }));

  pi.on("session_start", async (_event, ctx) => {
    try {
      await engine.startAutoAdapters();
      ctx.ui.notify(`Awareness loaded ${adapters.length} adapter(s)`, "info");
    } catch (error) {
      ctx.ui.notify(`Awareness adapter start failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    unsubscribePush();
    await engine.stopAll();
  });
}
