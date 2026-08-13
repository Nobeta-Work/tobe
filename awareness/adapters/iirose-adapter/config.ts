import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  assessment: {
    windowMs: number;
    floodWindowMs: number;
    floodThreshold: number;
    maxEventsPerWindow: number;
  };
  commands: {
    prefix: string;
    adminOnly: boolean;
    whitelist: string[];
  };
  plugins: {
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
  logging: { enabled: boolean; directory: string; includeRawFrames: boolean };
}

export interface PluginCommandsConfig {
  prefix: string;
  adminOnly: boolean;
  whiteList: string | string[];
}

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("./config.json", import.meta.url));

export function loadConfig(path = DEFAULT_CONFIG_PATH): IIroseConfig {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  assertConfig(value);
  return value;
}

function assertConfig(value: unknown): asserts value is IIroseConfig {
  if (!value || typeof value !== "object") throw new Error("IIROSE config must be an object");
  const config = value as Record<string, unknown>;
  const credentials = config.credentials as Record<string, unknown> | undefined;
  const connection = config.connection as Record<string, unknown> | undefined;
  const assessment = config.assessment as Record<string, unknown> | undefined;
  const plugins = config.plugins as Record<string, unknown> | undefined;
  const music = plugins?.music as Record<string, unknown> | undefined;
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
  for (const key of ["windowMs", "floodWindowMs", "floodThreshold", "maxEventsPerWindow"]) {
    if (!Number.isFinite(assessment?.[key])) throw new Error(`assessment.${key} must be a number`);
  }
  if (!music || typeof music.enabled !== "boolean") throw new Error("plugins.music.enabled must be boolean");
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
