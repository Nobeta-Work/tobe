import { access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AdapterFactory, AwarenessEngine, EnvAdapter, Unsubscribe } from "./adapter.ts";
import { AwarenessEngineImpl } from "./engine.ts";
import { registerAwarenessTools } from "./tools/index.ts";
import type { Observation } from "./type.ts";

export * from "./type.ts";
export * from "./adapter.ts";
export { AwarenessEngineImpl } from "./engine.ts";

interface AdapterModule {
  createAdapter?: AdapterFactory;
  default?: AdapterFactory;
}

const DEFAULT_ADAPTERS_DIR = fileURLToPath(new URL("./adapters", import.meta.url));
const ADAPTER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
let importSequence = 0;

/** 从固定的 adapters 根目录加载一个 Adapter；不接受任意文件路径。 */
export async function loadAdapter(adapterName: string, adaptersDir = DEFAULT_ADAPTERS_DIR): Promise<EnvAdapter> {
  if (!ADAPTER_NAME_PATTERN.test(adapterName)) {
    throw new Error(`Invalid adapter name: ${adapterName}`);
  }
  const entryPath = join(adaptersDir, adapterName, "ADAPTER.ts");
  try { await access(entryPath); }
  catch { throw new Error(`Adapter entry does not exist: adapters/${adapterName}/ADAPTER.ts`); }
  let module: AdapterModule;
  try {
    const entryUrl = pathToFileURL(entryPath);
    entryUrl.searchParams.set("awareness_load", `${Date.now()}-${importSequence++}`);
    module = await import(entryUrl.href) as AdapterModule;
  } catch (error) {
    throw new Error(`Failed to load adapter entry ${entryPath}`, { cause: error });
  }
  const factory = module.createAdapter ?? module.default;
  if (typeof factory !== "function") {
    throw new Error(`${entryPath} must export createAdapter() or a default factory`);
  }
  return await factory();
}

/** 仅加载 adapters/<name>/ADAPTER.ts；其他文件不会被当作入口执行。 */
export async function discoverAdapters(adaptersDir = DEFAULT_ADAPTERS_DIR): Promise<EnvAdapter[]> {
  const entries = await readdir(adaptersDir, { withFileTypes: true });
  const adapters: EnvAdapter[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(adaptersDir, entry.name, "ADAPTER.ts");
    try { await access(entryPath); } catch { continue; }
    adapters.push(await loadAdapter(entry.name, adaptersDir));
  }
  return adapters;
}

export function adapterDirectory(entryUrl: string): string {
  return dirname(fileURLToPath(entryUrl));
}

/** 把 Engine subscription 桥接为 Pi 会话消息，从而主动唤起 Agent。 */
export function subscribeAgentPush(pi: ExtensionAPI, engine: AwarenessEngine): Unsubscribe {
  return engine.subscribe((observation) => pushObservation(pi, observation));
}

export function pushObservation(pi: ExtensionAPI, observation: Observation): void {
  pi.sendMessage(
    {
      customType: "awareness-observation",
      content: JSON.stringify(observation),
      display: false,
      details: observation,
    },
    {
      triggerTurn: true,
      deliverAs: observation.attention === "high" || observation.attention === "max"
        ? "steer"
        : "followUp",
    },
  );
}

/** Pi extension 入口。Pi 负责调用；import 本文件本身不会启动网络连接。 */
export default async function awarenessExtension(pi: ExtensionAPI): Promise<void> {
  const engine = new AwarenessEngineImpl({}, (adapterName) => loadAdapter(adapterName));
  const adapters = await discoverAdapters();
  for (const adapter of adapters) engine.register(adapter);

  registerAwarenessTools(pi, engine);
  const unsubscribePush = subscribeAgentPush(pi, engine);

  pi.on("resources_discover", () => ({
    skillPaths: [
      fileURLToPath(new URL("./SKILL.md", import.meta.url)),
      ...engine.getAdapters().flatMap(({ adapter_id }) => engine.getAdapter(adapter_id)?.getSkillPaths() ?? []),
    ],
  }));

  pi.on("session_start", async (_event, ctx) => {
    try {
      await engine.startAutoAdapters();
      ctx.ui.notify(`Awareness loaded ${engine.getAdapters().length} adapter(s)`, "info");
    } catch (error) {
      ctx.ui.notify(`Awareness adapter start failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    unsubscribePush();
    await engine.stopAll();
  });
}
