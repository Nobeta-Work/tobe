import { MEDIA_DIR } from "../lib/paths.ts";
import { getSchemaConfig, saveSchemaConfig, type SchemaConfigTarget } from "../lib/schema-config.ts";

const target: SchemaConfigTarget = {
  id: "media",
  directory: MEDIA_DIR,
  label: "Media 模块",
  saveMessage: "Media 配置已写入文件。配置将在下一次运行 Agent 时生效。",
};

export async function getMediaConfig(): Promise<Record<string, unknown>> {
  return getSchemaConfig(target);
}

export async function saveMediaConfig(payload: unknown): Promise<Record<string, unknown>> {
  return saveSchemaConfig(target, payload);
}
