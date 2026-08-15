import { constants, copyFileSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface MediaApiConfig {
  enabled: boolean;
  baseUrl: string;
  endpoint: string;
  apiKeyEnv: string;
  model: string;
  timeoutMs: number;
  voice?: string;
  responseFormat?: string;
  downloadHosts?: string[];
}

export interface MediaConfig {
  enabled: boolean;
  dataDir: string;
  libDir: string;
  maxInputBytes: number;
  maxGeneratedBytes: number;
  providers: {
    imageRecognition: MediaApiConfig;
    audioRecognition: MediaApiConfig;
    imageGeneration: MediaApiConfig;
    audioGeneration: MediaApiConfig;
  };
}

const MEDIA_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = resolve(MEDIA_DIR, "config.json");
const TEMPLATE_CONFIG_PATH = resolve(MEDIA_DIR, "config.default.json");

export function loadMediaConfig(path = DEFAULT_CONFIG_PATH): MediaConfig {
  if (path === DEFAULT_CONFIG_PATH) ensureConfig(path, TEMPLATE_CONFIG_PATH);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<MediaConfig>;
  const baseDir = dirname(path);
  const template = JSON.parse(readFileSync(TEMPLATE_CONFIG_PATH, "utf8")) as MediaConfig;
  const dataDir = resolvePath(baseDir, raw.dataDir ?? template.dataDir);
  const libDir = resolvePath(baseDir, raw.libDir ?? template.libDir);
  const providers = {
    imageRecognition: { ...template.providers.imageRecognition, ...raw.providers?.imageRecognition },
    audioRecognition: { ...template.providers.audioRecognition, ...raw.providers?.audioRecognition },
    imageGeneration: { ...template.providers.imageGeneration, ...raw.providers?.imageGeneration },
    audioGeneration: { ...template.providers.audioGeneration, ...raw.providers?.audioGeneration },
  };
  const config: MediaConfig = {
    enabled: raw.enabled ?? template.enabled,
    dataDir,
    libDir,
    maxInputBytes: raw.maxInputBytes ?? template.maxInputBytes,
    maxGeneratedBytes: raw.maxGeneratedBytes ?? template.maxGeneratedBytes,
    providers,
  };
  validate(config);
  return config;
}

function resolvePath(baseDir: string, value: string): string { return isAbsolute(value) ? value : resolve(baseDir, value); }

function ensureConfig(path: string, template: string): void {
  try { copyFileSync(template, path, constants.COPYFILE_EXCL); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
}

function validate(config: MediaConfig): void {
  if (typeof config.enabled !== "boolean") throw new Error("media.enabled must be boolean");
  for (const [name, value] of Object.entries({ maxInputBytes: config.maxInputBytes, maxGeneratedBytes: config.maxGeneratedBytes })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`media.${name} must be a positive safe integer`);
  }
  if (!config.dataDir) throw new Error("media.dataDir must not be empty");
  if (!config.libDir) throw new Error("media.libDir must not be empty");
  for (const [name, provider] of Object.entries(config.providers)) {
    if (!Number.isSafeInteger(provider.timeoutMs) || provider.timeoutMs <= 0) throw new Error(`providers.${name}.timeoutMs must be positive`);
    if (provider.enabled && (!provider.baseUrl || !provider.model)) throw new Error(`providers.${name} requires baseUrl and model when enabled`);
    if (provider.downloadHosts && provider.downloadHosts.some((host) => typeof host !== "string" || !host.trim())) throw new Error(`providers.${name}.downloadHosts must contain hostnames`);
  }
}
