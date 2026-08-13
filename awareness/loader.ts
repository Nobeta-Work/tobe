import { access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AdapterFactory, EnvAdapter } from "./adapter.ts";

interface AdapterModule {
  createAdapter?: AdapterFactory;
  default?: AdapterFactory;
}

const DEFAULT_ADAPTERS_DIR = fileURLToPath(new URL("./adapters", import.meta.url));

/** 仅加载 adapters/<name>/ADAPTER.ts；其他文件不会被当作入口执行。 */
export async function discoverAdapters(adaptersDir = DEFAULT_ADAPTERS_DIR): Promise<EnvAdapter[]> {
  const entries = await readdir(adaptersDir, { withFileTypes: true });
  const adapters: EnvAdapter[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(adaptersDir, entry.name, "ADAPTER.ts");
    try { await access(entryPath); } catch { continue; }
    let module: AdapterModule;
    try { module = await import(pathToFileURL(entryPath).href) as AdapterModule; }
    catch (error) { throw new Error(`Failed to load adapter entry ${entryPath}`, { cause: error }); }
    const factory = module.createAdapter ?? module.default;
    if (typeof factory !== "function") {
      throw new Error(`${entryPath} must export createAdapter() or a default factory`);
    }
    adapters.push(await factory());
  }
  return adapters;
}

export function adapterDirectory(entryUrl: string): string {
  return dirname(fileURLToPath(entryUrl));
}
