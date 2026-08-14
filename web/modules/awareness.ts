import { copyFile, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { ADAPTERS_DIR } from "../lib/paths.ts";
import { writeJsonAtomic } from "../lib/files.ts";

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
    const config = await readOptionalJson(join(ADAPTERS_DIR, entry.name, "config.json"));
    const defaults = await readOptionalJson(join(ADAPTERS_DIR, entry.name, "config.default.json"));
    result.push({
      id: entry.name,
      configured: config !== null,
      hasSchema: await readOptionalJson(schemaPath(entry.name)) !== null,
      enabled: booleanValue(config ?? defaults, "enabled"),
      autoStart: booleanValue(config ?? defaults, "autoStart"),
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getAdapter(id: string): Promise<Record<string, unknown>> {
  assertAdapterId(id);
  const directory = join(ADAPTERS_DIR, id);
  const defaultPath = join(directory, "config.default.json");
  const configPath = join(directory, "config.json");
  const schema = await readOptionalJson(schemaPath(id));
  if (!schema) throw new HttpError(409, "该 Adapter 缺少 config.schema.json，Web 保持只读");
  const defaults = await readRequiredJson(defaultPath);
  let config = await readOptionalJson(configPath);
  if (!config) {
    await copyFile(defaultPath, configPath);
    config = structuredClone(defaults);
  }
  const sensitivePaths = collectSensitivePaths(schema);
  const { value, sensitive } = redactSensitive(config, sensitivePaths);
  return { id, config: value, defaults: redactSensitive(defaults, sensitivePaths).value, schema, sensitive };
}

export async function saveAdapter(id: string, payload: unknown): Promise<Record<string, unknown>> {
  assertAdapterId(id);
  if (!payload || typeof payload !== "object") throw new HttpError(400, "请求内容无效");
  const body = payload as { config?: unknown; sensitiveUpdates?: unknown; clearSensitive?: unknown };
  if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) throw new HttpError(400, "config 必须是对象");
  const schema = await readOptionalJson(schemaPath(id));
  if (!schema) throw new HttpError(409, "该 Adapter 缺少 config.schema.json，不能通过 Web 保存");
  const errors = validateSchema(body.config, schema, "config");
  if (errors.length) throw new HttpError(400, errors.join("；"));
  const configPath = join(ADAPTERS_DIR, id, "config.json");
  const previous = await readOptionalJson(configPath) ?? {};
  const next = structuredClone(body.config) as Record<string, unknown>;
  const sensitivePaths = collectSensitivePaths(schema);
  const updates = isRecord(body.sensitiveUpdates) ? body.sensitiveUpdates : {};
  const clears = Array.isArray(body.clearSensitive) ? body.clearSensitive.filter((value): value is string => typeof value === "string") : [];
  for (const path of sensitivePaths) {
    if (clears.includes(path)) deletePath(next, path);
    else if (typeof updates[path] === "string" && updates[path] !== "") setPath(next, path, updates[path]);
    else {
      const current = getPath(previous, path);
      if (current !== undefined) setPath(next, path, current);
    }
  }
  await writeJsonAtomic(configPath, next);
  return { saved: true, runtimeReloaded: false, message: "配置已写入文件。当前已实例化的 Adapter 不会自动重载。" };
}

function schemaPath(id: string): string { return join(ADAPTERS_DIR, id, "config.schema.json"); }

function assertAdapterId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*-adapter$/.test(id) || basename(id) !== id) throw new HttpError(400, "Adapter 名称无效");
}

async function readRequiredJson(path: string): Promise<Record<string, unknown>> {
  const result = await readOptionalJson(path);
  if (!result) throw new HttpError(404, `缺少文件: ${basename(path)}`);
  return result;
}

async function readOptionalJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isRecord(value) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function collectSensitivePaths(schema: Record<string, unknown>, prefix = ""): string[] {
  const result: string[] = [];
  if (schema["x-sensitive"] === true && prefix) result.push(prefix);
  if (isRecord(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      if (isRecord(child)) result.push(...collectSensitivePaths(child, prefix ? `${prefix}.${key}` : key));
    }
  }
  return result;
}

function redactSensitive(value: Record<string, unknown>, paths: string[]): { value: Record<string, unknown>; sensitive: Record<string, boolean> } {
  const copy = structuredClone(value);
  const sensitive: Record<string, boolean> = {};
  for (const path of paths) {
    const existing = getPath(copy, path);
    sensitive[path] = existing !== undefined && existing !== "";
    deletePath(copy, path);
  }
  return { value: copy, sensitive };
}

function validateSchema(value: unknown, schema: Record<string, unknown>, path: string): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (type === "object") {
    if (!isRecord(value)) return [`${path} 应为对象`];
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof required === "string" && !(required in value)) errors.push(`${path}.${required} 为必填项`);
    }
    for (const [key, child] of Object.entries(properties)) if (key in value && isRecord(child)) errors.push(...validateSchema(value[key], child, `${path}.${key}`));
  } else if (type === "array" && !Array.isArray(value)) errors.push(`${path} 应为数组`);
  else if (type === "string" && typeof value !== "string") errors.push(`${path} 应为文本`);
  else if (type === "boolean" && typeof value !== "boolean") errors.push(`${path} 应为布尔值`);
  else if (type === "number" && typeof value !== "number") errors.push(`${path} 应为数字`);
  else if (type === "integer" && !Number.isInteger(value)) errors.push(`${path} 应为整数`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} 不是允许的值`);
  return errors.slice(0, 12);
}

function getPath(root: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, root);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  const last = parts.pop();
  if (!last) return;
  let current = root;
  for (const part of parts) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[last] = value;
}

function deletePath(root: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  const last = parts.pop();
  if (!last) return;
  const parent = parts.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, root);
  if (isRecord(parent)) delete parent[last];
}

function booleanValue(value: Record<string, unknown> | null, key: string): boolean | null {
  return value && typeof value[key] === "boolean" ? value[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
