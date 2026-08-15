import { copyFile, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeJsonAtomic } from "./files.ts";

export interface SchemaConfigTarget {
  id: string;
  directory: string;
  label: string;
  saveMessage: string;
}

export async function getSchemaConfig(target: SchemaConfigTarget): Promise<Record<string, unknown>> {
  const defaultPath = join(target.directory, "config.default.json");
  const configPath = join(target.directory, "config.json");
  const schema = await readOptionalJson(join(target.directory, "config.schema.json"));
  if (!schema) throw new HttpError(409, `${target.label} 缺少 config.schema.json，Web 保持只读`);
  const defaults = await readRequiredJson(defaultPath);
  const stored = await readOptionalJson(configPath);
  let config: Record<string, unknown>;
  if (!stored) {
    await copyFile(defaultPath, configPath);
    config = structuredClone(defaults);
  } else config = mergeDefaults(defaults, stored);
  const sensitivePaths = collectSensitivePaths(schema);
  const { value, sensitive } = redactSensitive(config, sensitivePaths);
  return { id: target.id, config: value, defaults: redactSensitive(defaults, sensitivePaths).value, schema, sensitive };
}

export async function saveSchemaConfig(target: SchemaConfigTarget, payload: unknown): Promise<Record<string, unknown>> {
  if (!isRecord(payload)) throw new HttpError(400, "请求内容无效");
  const body = payload as { config?: unknown; sensitiveUpdates?: unknown; clearSensitive?: unknown };
  if (!isRecord(body.config)) throw new HttpError(400, "config 必须是对象");
  const schema = await readOptionalJson(join(target.directory, "config.schema.json"));
  if (!schema) throw new HttpError(409, `${target.label} 缺少 config.schema.json，不能通过 Web 保存`);
  const errors = validateSchema(body.config, schema, "config");
  if (errors.length) throw new HttpError(400, errors.join("；"));
  const configPath = join(target.directory, "config.json");
  const previous = await readOptionalJson(configPath) ?? {};
  const next = structuredClone(body.config);
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
  return { saved: true, runtimeReloaded: false, message: target.saveMessage };
}

export async function readOptionalJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isRecord(value) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readRequiredJson(path: string): Promise<Record<string, unknown>> {
  const result = await readOptionalJson(path);
  if (!result) throw new HttpError(404, `缺少文件: ${basename(path)}`);
  return result;
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

function mergeDefaults(defaults: Record<string, unknown>, stored: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(defaults);
  for (const [key, value] of Object.entries(stored)) {
    result[key] = isRecord(value) && isRecord(result[key])
      ? mergeDefaults(result[key] as Record<string, unknown>, value)
      : structuredClone(value);
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
    for (const [key, child] of Object.entries(properties)) {
      if (key in value && isRecord(child)) errors.push(...validateSchema(value[key], child, `${path}.${key}`));
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) errors.push(`${path} 应为数组`);
    else if (isRecord(schema.items)) value.forEach((item, index) => errors.push(...validateSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`)));
  } else if (type === "string") {
    if (typeof value !== "string") errors.push(`${path} 应为文本`);
    else if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path} 长度不足`);
  } else if (type === "boolean" && typeof value !== "boolean") errors.push(`${path} 应为布尔值`);
  else if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`${path} 应为数字`);
  else if (type === "integer" && !Number.isSafeInteger(value)) errors.push(`${path} 应为安全整数`);
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path} 不能小于 ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path} 不能大于 ${schema.maximum}`);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
