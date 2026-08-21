import type { WeChatConfig } from "../config.ts";
import type { WeChatIncomingMessage } from "../protocol.ts";
import { WECHAT_PUBLIC_USER_ID } from "../protocol.ts";
import { detectMimeType } from "../../../../media/files/mime.ts";
import type { MediaData, MediaMetadata } from "../../../../media/type.ts";

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
  sendMedia?(userId: string, media: MediaMetadata, caption?: string): Promise<void>;
  replyMedia?(message: WeChatIncomingMessage, media: MediaMetadata, caption?: string): Promise<void>;
  sendTyping(userId: string): Promise<void>;
  rememberUser?(nativeUserId: string): Promise<void>;
}

type WeChatSendContent = string | { image: Buffer; caption?: string } | { video: Buffer; caption?: string } | { file: Buffer; fileName: string; caption?: string };
interface WeChatDownloadedMedia { data: Buffer; type: "image" | "file" | "video" | "voice"; fileName?: string; format?: string }
interface WeChatCdnMedia { encrypt_query_param: string; aes_key: string; encrypt_type?: 0 | 1; full_url?: string }
interface WeChatWireItem { type: number; text_item?: { text: string }; voice_item?: { media: WeChatCdnMedia; encode_type: number; bits_per_sample?: number; sample_rate?: number; playtime?: number } }
interface WeChatWireMessage { from_user_id: string; to_user_id: string; client_id: string; message_type: number; message_state: number; context_token: string; item_list: WeChatWireItem[] }
interface SdkMessageBuilder { text(content: string): SdkMessageBuilder; build(): WeChatWireMessage }

interface SdkBot {
  storage: { has(key: string): Promise<boolean>; get<T>(key: string): Promise<T | undefined>; set<T>(key: string, value: T): Promise<void> };
  login(options?: { force?: boolean; callbacks?: LoginCallbacks }): Promise<WeChatCredentials>;
  start(): Promise<void>;
  stop(): void;
  isRunning: boolean;
  onMessage(handler: (message: WeChatIncomingMessage) => void | Promise<void>): unknown;
  on(event: string, handler: (...args: any[]) => void | Promise<void>): unknown;
  send(userId: string, content: WeChatSendContent): Promise<void>;
  reply(message: WeChatIncomingMessage, content: WeChatSendContent): Promise<void>;
  createMessage(userId: string): SdkMessageBuilder;
  upload(options: { data: Buffer; userId: string; mediaType: number }): Promise<{ media: WeChatCdnMedia }>;
  sendRaw(payload: WeChatWireMessage): Promise<void>;
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
  async sendText(userId: string, content: string): Promise<void> { const bot = await this.#getBot(); await bot.send(await this.#resolveUserId(bot, userId), content); }
  async replyText(message: WeChatIncomingMessage, content: string): Promise<void> { await (await this.#getBot()).reply(message, content); }
  async downloadMedia(message: WeChatIncomingMessage): Promise<MediaData | null> {
    const media = await (await this.#getBot()).download(message);
    if (!media) return null;
    const kind = media.type === "voice" ? "audio" : media.type;
    const detected = detectMimeType(media.data, media.fileName);
    const mimeType = media.type === "voice"
      ? media.format === "wav" ? "audio/wav" : "audio/silk"
      : media.type === "image" && detected.kind === "image" ? detected.mimeType
      : media.type === "video" ? "video/mp4" : "application/octet-stream";
    return { kind, mimeType, data: media.data, ...(media.fileName ? { fileName: media.fileName } : {}) };
  }
  async sendMedia(userId: string, media: MediaMetadata, caption?: string): Promise<void> {
    const bot = await this.#getBot();
    const nativeUserId = await this.#resolveUserId(bot, userId);
    if (media.kind === "audio") await sendWeChatVoice(bot, nativeUserId, media, caption);
    else await bot.send(nativeUserId, toSendContent(media, caption));
  }
  async replyMedia(message: WeChatIncomingMessage, media: MediaMetadata, caption?: string): Promise<void> {
    const bot = await this.#getBot();
    if (media.kind === "audio") await sendWeChatVoice(bot, message.userId, media, caption);
    else await bot.reply(message, toSendContent(media, caption));
  }
  async sendTyping(userId: string): Promise<void> { const bot = await this.#getBot(); await bot.sendTyping(await this.#resolveUserId(bot, userId)); }
  async rememberUser(nativeUserId: string): Promise<void> { await (await this.#getBot()).storage.set("adapter_user_0", nativeUserId); }

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
    bot.onMessage(async (message) => {
      await this.rememberUser(message.userId);
      await this.#events?.onMessage(message);
    });
    bot.on("session:expired", () => this.#events?.onSessionExpired());
    bot.on("session:restored", (credentials: WeChatCredentials) => this.#events?.onSessionRestored(credentials));
    bot.on("error", (error: unknown) => this.#events?.onError(error));
  }

  async #resolveUserId(bot: SdkBot, publicUserId: string): Promise<string> {
    if (publicUserId !== WECHAT_PUBLIC_USER_ID) throw new Error(`WeChat userId must be ${WECHAT_PUBLIC_USER_ID}`);
    const nativeUserId = await bot.storage.get<string>("adapter_user_0");
    if (!nativeUserId) throw new Error("WeChat user 0 has no established conversation yet");
    return nativeUserId;
  }
}

function toSendContent(media: MediaMetadata, caption?: string): Exclude<WeChatSendContent, string> {
  const data = Buffer.from(media.data);
  if (media.kind === "image") return { image: data, ...(caption ? { caption } : {}) };
  if (media.kind === "video") return { video: data, ...(caption ? { caption } : {}) };
  return { file: data, fileName: media.fileName ?? `media${extensionForMime(media.mimeType)}`, ...(caption ? { caption } : {}) };
}

/** Route audio through the SDK's low-level VOICE protocol instead of FILE. */
export async function sendWeChatVoice(bot: SdkBot, userId: string, media: MediaMetadata, caption?: string): Promise<void> {
  const uploaded = await bot.upload({ data: Buffer.from(media.data), userId, mediaType: 4 });
  const builder = bot.createMessage(userId);
  // MessageBuilder owns the conversation context token. Seed it, then remove
  // the seed from the built payload when no caption was requested.
  builder.text(caption || "\u200b");
  const payload = builder.build();
  const voiceItem = createVoiceItem(media, uploaded.media);
  payload.item_list = caption ? [...payload.item_list, voiceItem] : [voiceItem];
  await bot.sendRaw(payload);
}

export function createVoiceItem(media: MediaMetadata, cdnMedia: WeChatCdnMedia): WeChatWireItem {
  const format = voiceFormat(media.mimeType);
  return {
    type: 3,
    voice_item: {
      media: cdnMedia,
      encode_type: format.encodeType,
      ...(format.bitsPerSample ? { bits_per_sample: format.bitsPerSample } : {}),
      ...(format.sampleRate ? { sample_rate: format.sampleRate } : {}),
      ...(media.durationMs ? { playtime: Math.round(media.durationMs) } : {}),
    },
  };
}

function voiceFormat(mimeType: string): { encodeType: number; bitsPerSample?: number; sampleRate?: number } {
  if (mimeType === "audio/silk") return { encodeType: 6, bitsPerSample: 16, sampleRate: 24_000 };
  if (mimeType === "audio/mpeg") return { encodeType: 7 };
  if (mimeType === "audio/wav") return { encodeType: 1, bitsPerSample: 16 };
  if (mimeType === "audio/ogg") return { encodeType: 8 };
  throw new Error(`WeChat voice messages do not support ${mimeType}; use SILK, MP3, WAV, or OGG audio`);
}

function extensionForMime(mimeType: string): string {
  return ({ "audio/silk": ".silk", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg" } as Record<string, string>)[mimeType] ?? ".bin";
}
