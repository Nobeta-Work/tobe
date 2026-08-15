import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { ADAPTERS_DIR } from "../lib/paths.ts";
import { getSchemaConfig, HttpError, readOptionalJson, saveSchemaConfig, type SchemaConfigTarget } from "../lib/schema-config.ts";

export interface AdapterSummary {
  id: string;
  configured: boolean;
  hasSchema: boolean;
  enabled: boolean | null;
  autoStart: boolean | null;
}

export async function listAdapters(): Promise<AdapterSummary[]> {
  const entries = await readdir(ADAPTERS_DIR, { withFileTypes: true });
  const result: AdapterSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith("-adapter")) continue;
    const directory = join(ADAPTERS_DIR, entry.name);
    const config = await readOptionalJson(join(directory, "config.json"));
    const defaults = await readOptionalJson(join(directory, "config.default.json"));
    result.push({
      id: entry.name,
      configured: config !== null,
      hasSchema: await readOptionalJson(join(directory, "config.schema.json")) !== null,
      enabled: booleanValue(config ?? defaults, "enabled"),
      autoStart: booleanValue(config ?? defaults, "autoStart"),
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getAdapter(id: string): Promise<Record<string, unknown>> {
  return getSchemaConfig(adapterTarget(id));
}

export async function saveAdapter(id: string, payload: unknown): Promise<Record<string, unknown>> {
  return saveSchemaConfig(adapterTarget(id), payload);
}

function adapterTarget(id: string): SchemaConfigTarget {
  assertAdapterId(id);
  return {
    id,
    directory: join(ADAPTERS_DIR, id),
    label: "该 Adapter",
    saveMessage: "配置已写入文件。当前已实例化的 Adapter 不会自动重载。",
  };
}

function assertAdapterId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*-adapter$/.test(id) || basename(id) !== id) throw new HttpError(400, "Adapter 名称无效");
}

function booleanValue(value: Record<string, unknown> | null, key: string): boolean | null {
  return value && typeof value[key] === "boolean" ? value[key] : null;
}
