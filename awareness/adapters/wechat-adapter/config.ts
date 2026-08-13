import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type WeChatLogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface WeChatConfig {
  enabled: boolean;
  autoStart: boolean;
  storageDir: string;
  logLevel: WeChatLogLevel;
  botAgent: string;
  identity: { ownerIds: string[] };
  receive: { messageTypes: string[]; allowUsers: string[]; denyUsers: string[] };
  events: { dedupeTtlMs: number; messageCacheTtlMs: number; maxCachedMessages: number };
}

const ADAPTER_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = resolve(ADAPTER_DIR, "config.json");
const DEFAULTS: WeChatConfig = {
  enabled: true,
  autoStart: true,
  storageDir: resolve(ADAPTER_DIR, "data"),
  logLevel: "warn",
  botAgent: "ToBe/wechat-adapter",
  identity: { ownerIds: [] },
  receive: { messageTypes: ["text"], allowUsers: [], denyUsers: [] },
  events: { dedupeTtlMs: 3_600_000, messageCacheTtlMs: 3_600_000, maxCachedMessages: 500 },
};

export function loadConfig(path = DEFAULT_CONFIG_PATH): WeChatConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<WeChatConfig>;
  const baseDir = dirname(path);
  const configuredStorage = raw.storageDir ?? DEFAULTS.storageDir;
  const config: WeChatConfig = {
    ...DEFAULTS,
    ...raw,
    storageDir: isAbsolute(configuredStorage) ? configuredStorage : resolve(baseDir, configuredStorage),
    identity: { ...DEFAULTS.identity, ...raw.identity },
    receive: { ...DEFAULTS.receive, ...raw.receive },
    events: { ...DEFAULTS.events, ...raw.events },
  };
  assertConfig(config);
  return config;
}

function assertConfig(config: WeChatConfig): void {
  if (typeof config.enabled !== "boolean" || typeof config.autoStart !== "boolean") throw new Error("enabled and autoStart must be boolean");
  if (!config.storageDir.trim()) throw new Error("storageDir is required");
  if (!(["debug", "info", "warn", "error", "silent"] as string[]).includes(config.logLevel)) throw new Error("logLevel is invalid");
  for (const [name, value] of Object.entries({ ownerIds: config.identity.ownerIds, messageTypes: config.receive.messageTypes, allowUsers: config.receive.allowUsers, denyUsers: config.receive.denyUsers })) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name} must be a string array`);
  }
  for (const key of ["dedupeTtlMs", "messageCacheTtlMs", "maxCachedMessages"] as const) {
    if (!Number.isFinite(config.events[key]) || config.events[key] <= 0) throw new Error(`events.${key} must be positive`);
  }
}
