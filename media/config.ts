import { constants, copyFileSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MediaKind } from "./type.ts";

export interface MediaApiConfig {
  enabled: boolean;
  baseUrl: string;
  endpoint: string;
  apiKeyEnv: string;
  model: string;
  timeoutMs: number;
  voice?: string;
  responseFormat?: string;
}

export interface MediaConfig {
  enabled: boolean;
  dataDir: string;
  artifactTtlMs: number;
  maxInputBytes: number;
  maxGeneratedBytes: number;
  libraries: Record<string, { path: string; kinds: MediaKind[] }>;
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
  const libraries = Object.fromEntries(Object.entries(raw.libraries ?? template.libraries).map(([name, library]) => [name, {
    path: resolvePath(baseDir, library.path),
    kinds: library.kinds,
  }]));
  const providers = {
    imageRecognition: { ...template.providers.imageRecognition, ...raw.providers?.imageRecognition },
    audioRecognition: { ...template.providers.audioRecognition, ...raw.providers?.audioRecognition },
    imageGeneration: { ...template.providers.imageGeneration, ...raw.providers?.imageGeneration },
    audioGeneration: { ...template.providers.audioGeneration, ...raw.providers?.audioGeneration },
  };
  const config: MediaConfig = {
    enabled: raw.enabled ?? template.enabled,
    dataDir,
    artifactTtlMs: raw.artifactTtlMs ?? template.artifactTtlMs,
    maxInputBytes: raw.maxInputBytes ?? template.maxInputBytes,
    maxGeneratedBytes: raw.maxGeneratedBytes ?? template.maxGeneratedBytes,
    libraries,
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
  for (const [name, value] of Object.entries({ artifactTtlMs: config.artifactTtlMs, maxInputBytes: config.maxInputBytes, maxGeneratedBytes: config.maxGeneratedBytes })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`media.${name} must be a positive safe integer`);
  }
  for (const [name, library] of Object.entries(config.libraries)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`Invalid media library name: ${name}`);
    if (!library.path || !Array.isArray(library.kinds) || !library.kinds.length) throw new Error(`Invalid media library: ${name}`);
  }
  for (const [name, provider] of Object.entries(config.providers)) {
    if (!Number.isSafeInteger(provider.timeoutMs) || provider.timeoutMs <= 0) throw new Error(`providers.${name}.timeoutMs must be positive`);
    if (provider.enabled && (!provider.baseUrl || !provider.model)) throw new Error(`providers.${name} requires baseUrl and model when enabled`);
  }
}
