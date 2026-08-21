import { copyFile, mkdir, readFile } from "node:fs/promises";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { DATA_DIR, WEB_CONFIG_DEFAULT_PATH, WEB_CONFIG_PATH } from "./paths.ts";
import { writeJsonAtomic } from "./files.ts";

const scrypt = promisify(scryptCallback);

export interface WebConfig {
  host: string;
  port: number;
  allowedIps: string[];
  trustProxy: boolean;
  passwordHash: string;
  passwordSalt: string;
  customProvider: CustomProviderConfig;
}

export interface CustomProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextLimit: number;
  thinkingLevel: ThinkingLevel;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface StoredWebConfig extends Partial<WebConfig> {
  password?: string;
}

const defaults: WebConfig = {
  host: "0.0.0.0",
  port: 2222,
  allowedIps: [],
  trustProxy: false,
  passwordHash: "",
  passwordSalt: "",
  customProvider: {
    enabled: false, baseUrl: "", apiKey: "", model: "",
    temperature: 1, maxTokens: 16384, contextLimit: 128000, thinkingLevel: "off",
  },
};

export async function loadWebConfig(): Promise<WebConfig> {
  await mkdir(DATA_DIR, { recursive: true });
  let stored: StoredWebConfig;
  try {
    stored = JSON.parse(await readFile(WEB_CONFIG_PATH, "utf8")) as StoredWebConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await copyFile(WEB_CONFIG_DEFAULT_PATH, WEB_CONFIG_PATH);
    stored = JSON.parse(await readFile(WEB_CONFIG_PATH, "utf8")) as StoredWebConfig;
  }

  const result: WebConfig = {
    host: process.env.TOBE_WEB_HOST?.trim() || stored.host || defaults.host,
    port: parsePort(process.env.TOBE_WEB_PORT, stored.port ?? defaults.port),
    allowedIps: Array.isArray(stored.allowedIps) ? stored.allowedIps.filter(isNonEmptyString) : [],
    trustProxy: stored.trustProxy ?? defaults.trustProxy,
    passwordHash: stored.passwordHash?.trim() || "",
    passwordSalt: stored.passwordSalt?.trim() || "",
    customProvider: parseCustomProvider(stored.customProvider),
  };

  const environmentPassword = process.env.TOBE_WEB_PASSWORD;
  if (environmentPassword) {
    const credentials = await hashPassword(environmentPassword);
    result.passwordHash = credentials.hash;
    result.passwordSalt = credentials.salt;
  } else if (stored.password?.length) {
    const credentials = await hashPassword(stored.password);
    result.passwordHash = credentials.hash;
    result.passwordSalt = credentials.salt;
    await writeJsonAtomic(WEB_CONFIG_PATH, { ...result });
  }

  if (Boolean(result.passwordHash) !== Boolean(result.passwordSalt)) {
    throw new Error("Web passwordHash and passwordSalt must be configured together");
  }
  return result;
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 32) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function saveWebConfig(config: WebConfig): Promise<void> {
  await writeJsonAtomic(WEB_CONFIG_PATH, config);
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid web port: ${value}`);
  return port;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseCustomProvider(value: unknown): CustomProviderConfig {
  if (!value || typeof value !== "object") return { ...defaults.customProvider };
  const provider = value as Partial<CustomProviderConfig>;
  return {
    enabled: provider.enabled === true,
    baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "",
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
    model: typeof provider.model === "string" ? provider.model.trim() : "",
    temperature: finiteNumber(provider.temperature, defaults.customProvider.temperature, 0, 2),
    maxTokens: positiveInteger(provider.maxTokens, defaults.customProvider.maxTokens),
    contextLimit: positiveInteger(provider.contextLimit, defaults.customProvider.contextLimit),
    thinkingLevel: isThinkingLevel(provider.thinkingLevel) ? provider.thinkingLevel : defaults.customProvider.thinkingLevel,
  };
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}
