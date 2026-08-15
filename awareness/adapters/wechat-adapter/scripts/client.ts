import type { WeChatConfig } from "../config.ts";
import type { WeChatIncomingMessage } from "../protocol.ts";
import type { MediaData, ResolvedMedia } from "../../../../media/type.ts";

export interface WeChatCredentials { accountId: string; userId: string; savedAt?: string }
export interface LoginCallbacks {
  onQrUrl(url: string): void;
  onScanned(): void;
  onExpired(): void;
  onVerifyCode(isRetry: boolean): Promise<string>;
}
export interface WeChatGatewayEvents {
  onMessage(message: WeChatIncomingMessage): void | Promise<void>;
  onSessionExpired(): void | Promise<void>;
  onSessionRestored(credentials: WeChatCredentials): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
}
export interface WeChatGateway {
  hasStoredCredentials(): Promise<boolean>;
  login(callbacks: LoginCallbacks, force?: boolean): Promise<WeChatCredentials>;
  start(events: WeChatGatewayEvents): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  sendText(userId: string, content: string): Promise<void>;
  replyText(message: WeChatIncomingMessage, content: string): Promise<void>;
  downloadMedia?(message: WeChatIncomingMessage): Promise<MediaData | null>;
  sendMedia?(userId: string, media: ResolvedMedia, caption?: string): Promise<void>;
  replyMedia?(message: WeChatIncomingMessage, media: ResolvedMedia, caption?: string): Promise<void>;
  sendTyping(userId: string): Promise<void>;
}

type WeChatSendContent = string | { image: Buffer; caption?: string } | { video: Buffer; caption?: string } | { file: Buffer; fileName: string; caption?: string };
interface WeChatDownloadedMedia { data: Buffer; type: "image" | "file" | "video" | "voice"; fileName?: string; format?: string }

interface SdkBot {
  storage: { has(key: string): Promise<boolean> };
  login(options?: { force?: boolean; callbacks?: LoginCallbacks }): Promise<WeChatCredentials>;
  start(): Promise<void>;
  stop(): void;
  isRunning: boolean;
  onMessage(handler: (message: WeChatIncomingMessage) => void | Promise<void>): unknown;
  on(event: string, handler: (...args: any[]) => void | Promise<void>): unknown;
  send(userId: string, content: WeChatSendContent): Promise<void>;
  reply(message: WeChatIncomingMessage, content: WeChatSendContent): Promise<void>;
  download(message: WeChatIncomingMessage): Promise<WeChatDownloadedMedia | null>;
  sendTyping(userId: string): Promise<void>;
}

type BotConstructor = new (options: Record<string, unknown>) => SdkBot;

async function importModule(specifier: string): Promise<Record<string, unknown>> {
  const resolved = import.meta.resolve(specifier);
  return import(resolved) as Promise<Record<string, unknown>>;
}

export class SdkWeChatGateway implements WeChatGateway {
  readonly #config: WeChatConfig;
  #bot: SdkBot | null = null;
  #events: WeChatGatewayEvents | null = null;
  #pollTask: Promise<void> | null = null;

  constructor(config: WeChatConfig) { this.#config = config; }

  async hasStoredCredentials(): Promise<boolean> {
    const bot = await this.#getBot();
    return bot.storage.has("credentials");
  }

  async login(callbacks: LoginCallbacks, force = false): Promise<WeChatCredentials> {
    const bot = await this.#getBot();
    return bot.login({ force, callbacks });
  }

  async start(events: WeChatGatewayEvents): Promise<void> {
    const bot = await this.#getBot();
    this.#events = events;
    if (bot.isRunning || this.#pollTask) return;
    this.#wireEvents(bot);
    this.#pollTask = bot.start().catch((error) => { void this.#events?.onError(error); }).finally(() => { this.#pollTask = null; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  async stop(): Promise<void> {
    this.#bot?.stop();
    this.#events = null;
  }

  isRunning(): boolean { return this.#bot?.isRunning ?? false; }
  async sendText(userId: string, content: string): Promise<void> { await (await this.#getBot()).send(userId, content); }
  async replyText(message: WeChatIncomingMessage, content: string): Promise<void> { await (await this.#getBot()).reply(message, content); }
  async downloadMedia(message: WeChatIncomingMessage): Promise<MediaData | null> {
    const media = await (await this.#getBot()).download(message);
    if (!media) return null;
    const kind = media.type === "voice" ? "audio" : media.type;
    const mimeType = media.type === "voice"
      ? media.format === "wav" ? "audio/wav" : "audio/silk"
      : media.type === "image" ? imageMime(media.fileName)
      : media.type === "video" ? "video/mp4" : "application/octet-stream";
    return { kind, mimeType, data: media.data, ...(media.fileName ? { fileName: media.fileName } : {}) };
  }
  async sendMedia(userId: string, media: ResolvedMedia, caption?: string): Promise<void> {
    await (await this.#getBot()).send(userId, toSendContent(media, caption));
  }
  async replyMedia(message: WeChatIncomingMessage, media: ResolvedMedia, caption?: string): Promise<void> {
    await (await this.#getBot()).reply(message, toSendContent(media, caption));
  }
  async sendTyping(userId: string): Promise<void> { await (await this.#getBot()).sendTyping(userId); }

  async #getBot(): Promise<SdkBot> {
    if (this.#bot) return this.#bot;
    let module: Record<string, unknown>;
    try { module = await importModule("@wechatbot/wechatbot"); }
    catch (error) { throw new Error("wechat-adapter requires @wechatbot/wechatbot; install dependencies in the adapter directory", { cause: error }); }
    const WeChatBot = module.WeChatBot as BotConstructor | undefined;
    if (!WeChatBot) throw new Error("@wechatbot/wechatbot does not export WeChatBot");
    this.#bot = new WeChatBot({ storage: "file", storageDir: this.#config.storageDir, logLevel: this.#config.logLevel, botAgent: this.#config.botAgent });
    // The SDK normally starts an invisible QR flow after session expiry. Require
    // callbacks so re-authentication remains an explicit Adapter interaction.
    const sdkLogin = this.#bot.login.bind(this.#bot);
    this.#bot.login = (options = {}) => {
      if (options.force && !options.callbacks) return Promise.reject(new Error("Explicit WeChat login is required after session expiry"));
      return sdkLogin(options);
    };
    return this.#bot;
  }

  #wireEvents(bot: SdkBot): void {
    bot.onMessage((message) => this.#events?.onMessage(message));
    bot.on("session:expired", () => this.#events?.onSessionExpired());
    bot.on("session:restored", (credentials: WeChatCredentials) => this.#events?.onSessionRestored(credentials));
    bot.on("error", (error: unknown) => this.#events?.onError(error));
  }
}

function toSendContent(media: ResolvedMedia, caption?: string): Exclude<WeChatSendContent, string> {
  const data = Buffer.from(media.data);
  if (media.artifact.kind === "image") return { image: data, ...(caption ? { caption } : {}) };
  if (media.artifact.kind === "video") return { video: data, ...(caption ? { caption } : {}) };
  return { file: data, fileName: media.artifact.fileName ?? `media-${media.artifact.id}`, ...(caption ? { caption } : {}) };
}

function imageMime(fileName?: string): string {
  const lower = fileName?.toLowerCase() ?? "";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
