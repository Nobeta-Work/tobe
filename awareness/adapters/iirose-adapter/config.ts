import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAdapterDataPath } from "../../adapter-data.ts";
import { ensureAdapterConfig } from "../../config-file.ts";
import type { ActivePluginConfig } from "./plugins/active.ts";
import type { RoomPluginConfig } from "./plugins/room.ts";

export interface IIroseConfig {
  enabled: boolean;
  autoStart: boolean;
  websocketUrl: string;
  /** ToBe 在当前 IIROSE 环境中的称呼，可不同于登录 username。 */
  nickname: string;
  credentials: {
    username: string;
    uid: string;
    password: string;
    roomId: string;
    roomPassword: string;
  };
  profile: { status: string; signature: string; messageColor: string };
  adminsIds: string[];
  connection: {
    loginTimeoutMs: number;
    heartbeatIntervalMs: number;
    reconnect: boolean;
    reconnectInitialDelayMs: number;
    reconnectMaxDelayMs: number;
    maxReconnectAttempts: number;
  };
  commands: {
    prefix: string;
    adminOnly: boolean;
    whitelist: string[];
  };
  plugins: {
    active: ActivePluginConfig;
    room: RoomPluginConfig;
    welcome: {
      enabled: boolean;
      template: string;
      perUserCooldownMs: number;
      globalWindowMs: number;
      globalMaxMessages: number;
      commands: Partial<PluginCommandsConfig>;
    };
    music: {
      enabled: boolean;
      commands: PluginCommandsConfig;
      searchEndpoint: string;
      streamEndpoint: string;
      source: "netease";
      quality: number;
      bitRate: number;
      color: string;
    };
  };
  media: {
    uploadEndpoint: string;
    publicBaseUrl: string;
    timeoutMs: number;
    maxBytes: number;
    audioCoverUrl: string;
    audioBitRate: number;
  };
  logging: { directory: string; includeRawFrames: boolean };
}

export interface PluginCommandsConfig {
  prefix: string;
  adminOnly: boolean;
  whiteList: string | string[];
}

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("./config.json", import.meta.url));
const TEMPLATE_CONFIG_PATH = fileURLToPath(new URL("./config.default.json", import.meta.url));
const ADAPTER_DIR = dirname(DEFAULT_CONFIG_PATH);

export function loadConfig(path?: string): IIroseConfig {
  const configPath = path ?? ensureAdapterConfig(DEFAULT_CONFIG_PATH, TEMPLATE_CONFIG_PATH);
  const value = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  applyBackwardCompatibleDefaults(value);
  assertConfig(value);
  value.logging.directory = resolveAdapterDataPath(ADAPTER_DIR, value.logging.directory, "data/logs");
  return value;
}

function applyBackwardCompatibleDefaults(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const config = value as Record<string, unknown>;
  const plugins = config.plugins && typeof config.plugins === "object"
    ? config.plugins as Record<string, unknown>
    : (config.plugins = {}) as Record<string, unknown>;
  plugins.active ??= { level: "off", longWindowMs: 600_000, shortWindowMs: 120_000 };
  plugins.room ??= { enabled: true, follow: false };
  config.media ??= {
    uploadEndpoint: "https://f.iirose.com/lib/php/system/file_upload.php",
    publicBaseUrl: "http://r.iirose.com/",
    timeoutMs: 30_000,
    maxBytes: 20_000_000,
    audioCoverUrl: "http://r.iirose.com/i/26/3/6/4/5918-8B.png",
    audioBitRate: 320,
  };
}

function assertConfig(value: unknown): asserts value is IIroseConfig {
  if (!value || typeof value !== "object") throw new Error("IIROSE config must be an object");
  const config = value as Record<string, unknown>;
  const credentials = config.credentials as Record<string, unknown> | undefined;
  const connection = config.connection as Record<string, unknown> | undefined;
  const plugins = config.plugins as Record<string, unknown> | undefined;
  const music = plugins?.music as Record<string, unknown> | undefined;
  const active = plugins?.active as Record<string, unknown> | undefined;
  const room = plugins?.room as Record<string, unknown> | undefined;
  const media = config.media as Record<string, unknown> | undefined;
  if (typeof config.enabled !== "boolean" || typeof config.autoStart !== "boolean") {
    throw new Error("config.enabled and config.autoStart must be boolean");
  }
  if (typeof config.websocketUrl !== "string" || !config.websocketUrl.startsWith("wss://")) {
    throw new Error("config.websocketUrl must use wss://");
  }
  if (typeof config.nickname !== "string") throw new Error("config.nickname must be string");
  for (const key of ["username", "uid", "password", "roomId", "roomPassword"]) {
    if (typeof credentials?.[key] !== "string") throw new Error(`credentials.${key} must be string`);
  }
  if (!Array.isArray(config.adminsIds) || config.adminsIds.some((id) => typeof id !== "string")) {
    throw new Error("config.adminsIds must be a string array");
  }
  for (const key of ["loginTimeoutMs", "heartbeatIntervalMs", "reconnectInitialDelayMs", "reconnectMaxDelayMs", "maxReconnectAttempts"]) {
    if (!Number.isFinite(connection?.[key])) throw new Error(`connection.${key} must be a number`);
  }
  if (!music || typeof music.enabled !== "boolean") throw new Error("plugins.music.enabled must be boolean");
  if (!active || !["off", "low", "medium", "high"].includes(String(active.level))
    || !Number.isFinite(active.longWindowMs) || !Number.isFinite(active.shortWindowMs)) {
    throw new Error("plugins.active is invalid");
  }
  if (!room || typeof room.enabled !== "boolean" || typeof room.follow !== "boolean") {
    throw new Error("plugins.room is invalid");
  }
  if (!media || typeof media.uploadEndpoint !== "string" || !media.uploadEndpoint.startsWith("https://")
    || typeof media.publicBaseUrl !== "string" || !/^https?:\/\//.test(media.publicBaseUrl)
    || !Number.isFinite(media.timeoutMs) || !Number.isFinite(media.maxBytes)
    || typeof media.audioCoverUrl !== "string" || !/^https?:\/\//.test(media.audioCoverUrl)
    || !Number.isFinite(media.audioBitRate)) {
    throw new Error("media upload configuration is invalid");
  }
  assertPluginCommands(music.commands, "plugins.music.commands");
  for (const key of ["searchEndpoint", "streamEndpoint"]) {
    if (typeof music[key] !== "string" || !String(music[key]).startsWith("https://")) {
      throw new Error(`plugins.music.${key} must use https://`);
    }
  }
  for (const key of ["quality", "bitRate"]) {
    if (!Number.isFinite(music[key])) throw new Error(`plugins.music.${key} must be a number`);
  }
  if (music.source !== "netease" || typeof music.color !== "string") {
    throw new Error("plugins.music source/color are invalid");
  }
}

function assertPluginCommands(value: unknown, path: string): asserts value is PluginCommandsConfig {
  if (!value || typeof value !== "object") throw new Error(`${path} must be an object`);
  const commands = value as Record<string, unknown>;
  if (typeof commands.prefix !== "string" || typeof commands.adminOnly !== "boolean") {
    throw new Error(`${path}.prefix/adminOnly are invalid`);
  }
  const whiteList = commands.whiteList;
  if (typeof whiteList !== "string" && (!Array.isArray(whiteList) || whiteList.some((item) => typeof item !== "string"))) {
    throw new Error(`${path}.whiteList must be a string or string array`);
  }
}
