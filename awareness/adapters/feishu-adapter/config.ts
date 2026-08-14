import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureAdapterConfig } from "../../config-file.ts";

export type FeishuReceiveIdType = "open_id" | "user_id" | "union_id" | "email" | "chat_id";

export interface FeishuConfig {
  enabled: boolean;
  autoStart: boolean;
  nickname: string;
  credentials: {
    appId: string;
    /** 存放 App Secret 的环境变量名。 */
    appSecretEnv: string;
    appSecret?: string;
  };
  identity: {
    idType: "open_id";
    adminsIds: string[];
    botOpenId?: string;
  };
  connection: {
    autoReconnect: boolean;
    handshakeTimeoutMs: number;
    pingTimeoutSeconds: number;
  };
  receive: {
    directMessages: boolean;
    groupMessages: boolean;
    requireMentionInGroup: boolean;
    allowChats: string[];
    denyChats: string[];
    ignoreBotMessages: boolean;
    messageTypes: string[];
  };
  send: {
    defaultReceiveIdType: FeishuReceiveIdType;
    replyInThread: boolean;
    splitMultiline: boolean;
    typingDelay: boolean;
    baseDelayMs: number;
    perCharacterDelayMs: number;
    maxDelayMs: number;
  };
  assessment: {
    windowMs: number;
    floodWindowMs: number;
    floodThreshold: number;
    maxEventsPerWindow: number;
  };
  commands: {
    enabled: boolean;
    prefix: string;
    adminOnly: boolean;
    whiteList: string[];
  };
  events: { dedupeTtlMs: number };
  logging: { enabled: boolean; includeRawEvents: boolean };
}

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("./config.json", import.meta.url));
const TEMPLATE_CONFIG_PATH = fileURLToPath(new URL("./config.default.json", import.meta.url));

const DEFAULTS: FeishuConfig = {
  enabled: true,
  autoStart: false,
  nickname: "Be",
  credentials: { appId: "", appSecretEnv: "TOBE_FEISHU_APP_SECRET" },
  identity: { idType: "open_id", adminsIds: [] },
  connection: { autoReconnect: true, handshakeTimeoutMs: 15_000, pingTimeoutSeconds: 10 },
  receive: {
    directMessages: true,
    groupMessages: true,
    requireMentionInGroup: true,
    allowChats: [],
    denyChats: [],
    ignoreBotMessages: true,
    messageTypes: ["text", "post", "image", "file", "audio"],
  },
  send: {
    defaultReceiveIdType: "chat_id",
    replyInThread: true,
    splitMultiline: true,
    typingDelay: true,
    baseDelayMs: 180,
    perCharacterDelayMs: 35,
    maxDelayMs: 1_800,
  },
  assessment: { windowMs: 60_000, floodWindowMs: 10_000, floodThreshold: 20, maxEventsPerWindow: 100 },
  commands: { enabled: true, prefix: "{name}", adminOnly: false, whiteList: ["help", "status", "ping"] },
  events: { dedupeTtlMs: 3_600_000 },
  logging: { enabled: false, includeRawEvents: false },
};

export function loadConfig(path?: string): FeishuConfig {
  const configPath = path ?? ensureAdapterConfig(DEFAULT_CONFIG_PATH, TEMPLATE_CONFIG_PATH);
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error("Feishu config must be an object");
  const value = raw as Partial<FeishuConfig>;
  const config: FeishuConfig = {
    ...DEFAULTS,
    ...value,
    credentials: { ...DEFAULTS.credentials, ...value.credentials },
    identity: { ...DEFAULTS.identity, ...value.identity },
    connection: { ...DEFAULTS.connection, ...value.connection },
    receive: { ...DEFAULTS.receive, ...value.receive },
    send: { ...DEFAULTS.send, ...value.send },
    assessment: { ...DEFAULTS.assessment, ...value.assessment },
    commands: { ...DEFAULTS.commands, ...value.commands },
    events: { ...DEFAULTS.events, ...value.events },
    logging: { ...DEFAULTS.logging, ...value.logging },
  };
  assertConfig(config);
  return config;
}

export function resolveAppSecret(config: FeishuConfig): string {
  if (config.credentials.appSecret?.trim()) return config.credentials.appSecret.trim();
  const reference = config.credentials.appSecretEnv.trim();
  return reference ? process.env[reference]?.trim() ?? "" : "";
}

/** 凭证是运行条件，不是 Adapter 被发现和注册的条件。 */
export function feishuConfigurationError(config: FeishuConfig): string | undefined {
  if (!config.credentials.appId.trim()) return "credentials.appId is required";
  if (!/^cli_[0-9a-fA-F]{16}$/.test(config.credentials.appId.trim())) {
    return "credentials.appId must match cli_ followed by 16 hexadecimal characters";
  }
  if (!resolveAppSecret(config)) {
    const reference = config.credentials.appSecretEnv.trim();
    return reference
      ? `Feishu app secret environment variable is not set: ${reference}`
      : "Feishu app secret is required";
  }
  return undefined;
}

export function assertFeishuConfigured(config: FeishuConfig): void {
  const message = feishuConfigurationError(config);
  if (message) throw new Error(`feishu-adapter is not configured: ${message}`);
}

function assertConfig(config: FeishuConfig): void {
  if (typeof config.enabled !== "boolean" || typeof config.autoStart !== "boolean") {
    throw new Error("config.enabled and config.autoStart must be boolean");
  }
  if (!Array.isArray(config.identity.adminsIds) || config.identity.adminsIds.some((id) => typeof id !== "string")) {
    throw new Error("identity.adminsIds must be a string array");
  }
  if (config.identity.idType !== "open_id") throw new Error("v0.1 only supports identity.idType=open_id");
  if (!Array.isArray(config.receive.allowChats) || !Array.isArray(config.receive.denyChats)) {
    throw new Error("receive allowChats/denyChats must be arrays");
  }
  for (const key of ["windowMs", "floodWindowMs", "floodThreshold", "maxEventsPerWindow"] as const) {
    if (!Number.isFinite(config.assessment[key])) throw new Error(`assessment.${key} must be a number`);
  }
}
