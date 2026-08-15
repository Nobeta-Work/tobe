import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getMedia, mediaErrorResult, parseMediaInput } from "../../../media/index.ts";
import type { MediaData, MediaService } from "../../../media/type.ts";
import type { AdapterHealth, EnvAdapter, ObservationListener, Unsubscribe } from "../../adapter.ts";
import type { Actor, AdapterCallResult, Interaction, Level, Observation, ObserveRequest } from "../../type.ts";
import { loadConfig, type WeChatConfig } from "./config.ts";
import { messageFingerprint, publicMessageId, type WeChatIncomingMessage } from "./protocol.ts";
import { SdkWeChatGateway, type LoginCallbacks, type WeChatCredentials, type WeChatGateway, type WeChatGatewayEvents } from "./scripts/client.ts";
import { WECHAT_ACTIONS } from "./tools/index.ts";

type LoginStatus = "idle" | "restoring" | "login_required" | "requesting_qr" | "waiting_scan" | "scanned" | "verify_code_required" | "online" | "failed";
interface CachedMessage { message: WeChatIncomingMessage; expiresAt: number }
interface PendingVerify { resolve(code: string): void; reject(error: Error): void }

export interface WeChatAdapterOptions { configPath?: string; config?: WeChatConfig; gateway?: WeChatGateway; mediaService?: MediaService }

export class WeChatAdapter implements EnvAdapter {
  readonly id = randomUUID().replaceAll("-", "").slice(0, 10);
  readonly name = "wechat-adapter";
  readonly permission: Level = "medium";
  readonly autoStart: boolean;
  readonly #config: WeChatConfig;
  readonly #gateway: WeChatGateway;
  readonly #mediaServiceOverride: MediaService | undefined;
  readonly #listeners = new Set<ObservationListener>();
  readonly #seen = new Map<string, number>();
  readonly #messages = new Map<string, CachedMessage>();
  #health: AdapterHealth = { status: "stopped", since: Date.now() };
  #loginStatus: LoginStatus = "idle";
  #qrUrl: string | undefined;
  #account?: { accountId: string; userId: string };
  #loginTask: Promise<void> | null = null;
  #pendingVerify: PendingVerify | null = null;
  #stopping = false;

  constructor(options: WeChatAdapterOptions = {}) {
    this.#config = options.config ?? loadConfig(options.configPath);
    this.autoStart = this.#config.enabled && this.#config.autoStart;
    this.#gateway = options.gateway ?? new SdkWeChatGateway(this.#config);
    this.#mediaServiceOverride = options.mediaService;
  }

  /** Auto-start only restores an existing session; it never creates a QR login flow. */
  async start(): Promise<void> {
    if (!this.#config.enabled) throw new Error("wechat-adapter is disabled in config.json");
    if (this.#health.status === "starting" || this.#health.status === "online") return;
    this.#stopping = false;
    this.#loginStatus = "restoring";
    this.#setHealth("starting");
    try {
      if (!(await this.#gateway.hasStoredCredentials())) {
        await this.#requireLogin("No stored WeChat credentials");
        return;
      }
      const credentials = await this.#gateway.login(this.#silentCallbacks(), false);
      await this.#goOnline(credentials, "session_restored");
    } catch (error) {
      await this.#requireLogin(errorMessage(error));
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#pendingVerify?.reject(new Error("Login cancelled because adapter stopped"));
    this.#pendingVerify = null;
    await this.#gateway.stop();
    this.#loginTask = null;
    this.#qrUrl = undefined;
    this.#loginStatus = "idle";
    this.#setHealth("stopped");
  }

  async observe(request: ObserveRequest): Promise<AdapterCallResult> {
    if (request.action === "status") return this.#result(request.call_id, request.action, {
      status: "success", health: this.health(), loginStatus: this.#loginStatus, running: this.#gateway.isRunning(),
      ...(this.#qrUrl ? { qrUrl: this.#qrUrl } : {}), ...(this.#account ? { account: this.#account } : {}),
      verifyCodeRequired: this.#pendingVerify !== null,
    });
    return this.#result(request.call_id, request.action, { status: "error", message: `Unsupported observe action: ${request.action}` });
  }

  async interact(interaction: Interaction): Promise<AdapterCallResult> {
    try {
      switch (interaction.action) {
        case "login": return await this.#beginInteractiveLogin(interaction);
        case "submit_verify_code": {
          const code = requireString(interaction.args.code, "code");
          if (!this.#pendingVerify) throw new Error("No WeChat verification code is currently requested");
          const pending = this.#pendingVerify;
          this.#pendingVerify = null;
          pending.resolve(code);
          return this.#result(interaction.call_id, interaction.action, { status: "success", loginStatus: "scanned" });
        }
        case "disconnect":
          await this.stop();
          return this.#result(interaction.call_id, interaction.action, { status: "success" });
        case "send_message": {
          this.#assertOnline();
          const userId = requireString(interaction.args.userId, "userId");
          const content = requireString(interaction.args.content, "content");
          await this.#gateway.sendText(userId, content);
          return this.#result(interaction.call_id, interaction.action, { status: "success", userId });
        }
        case "reply_message": {
          this.#assertOnline();
          const messageId = requireString(interaction.args.messageId, "messageId");
          const content = requireString(interaction.args.content, "content");
          const cached = this.#takeCachedMessage(messageId);
          if (!cached) throw new Error("Message is unknown or its reply context has expired");
          await this.#gateway.replyText(cached, content);
          return this.#result(interaction.call_id, interaction.action, { status: "success", messageId });
        }
        case "send_media": {
          this.#assertOnline();
          const userId = requireString(interaction.args.userId, "userId");
          if (!this.#gateway.sendMedia) throw new Error("WeChat gateway does not support media sending");
          const service = this.#requireMediaService();
          const resolved = await service.resolve(parseMediaInput(interaction.args.media), wechatMediaConstraints());
          const caption = optionalString(interaction.args.caption, "caption");
          await this.#gateway.sendMedia(userId, resolved, caption);
          return this.#result(interaction.call_id, interaction.action, { status: "success", userId, media: resolved.artifact });
        }
        case "reply_media": {
          this.#assertOnline();
          const messageId = requireString(interaction.args.messageId, "messageId");
          if (!this.#gateway.replyMedia) throw new Error("WeChat gateway does not support media replies");
          const cached = this.#takeCachedMessage(messageId);
          if (!cached) throw new Error("Message is unknown or its reply context has expired");
          const service = this.#requireMediaService();
          const resolved = await service.resolve(parseMediaInput(interaction.args.media), wechatMediaConstraints());
          const caption = optionalString(interaction.args.caption, "caption");
          await this.#gateway.replyMedia(cached, resolved, caption);
          return this.#result(interaction.call_id, interaction.action, { status: "success", messageId, media: resolved.artifact });
        }
        case "send_typing": {
          this.#assertOnline();
          const userId = requireString(interaction.args.userId, "userId");
          await this.#gateway.sendTyping(userId);
          return this.#result(interaction.call_id, interaction.action, { status: "success", userId });
        }
        default: throw new Error(`Unsupported WeChat action: ${interaction.action}`);
      }
    } catch (error) {
      return this.#result(interaction.call_id, interaction.action, { status: "error", message: errorMessage(error) });
    }
  }

  health(): AdapterHealth { return { ...this.#health }; }
  subscribe(listener: ObservationListener): Unsubscribe { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  getSkillPaths(): readonly string[] { return [fileURLToPath(new URL("./SKILL.md", import.meta.url))]; }
  getActions() { return WECHAT_ACTIONS; }

  /** Public protocol entry for gateway reuse and offline tests. */
  async handleMessage(message: WeChatIncomingMessage): Promise<void> {
    const now = Date.now();
    this.#prune(now);
    const fingerprint = messageFingerprint(message);
    if (this.#seen.has(fingerprint)) return;
    this.#seen.set(fingerprint, now + this.#config.events.dedupeTtlMs);
    if (!this.#config.receive.messageTypes.includes(message.type)) return;
    if (this.#config.receive.denyUsers.includes(message.userId)) return;
    if (this.#config.receive.allowUsers.length && !this.#config.receive.allowUsers.includes(message.userId)) return;
    const messageId = publicMessageId(message);
    this.#messages.set(messageId, { message, expiresAt: now + this.#config.events.messageCacheTtlMs });
    while (this.#messages.size > this.#config.events.maxCachedMessages) this.#messages.delete(this.#messages.keys().next().value as string);
    this.#health = { ...this.#health, lastEventAt: now };
    const actor: Actor = this.#config.identity.ownerIds.includes(message.userId) ? "user" : "service";
    const recognized = await this.#recognizeMedia(message);
    await this.#emit({
      id: fingerprint, adapter_id: this.id, adapter_name: this.name, source: `wechat:${message.userId}`, actor,
      content: {
        eventType: "message.received", messageId, userId: message.userId, messageType: message.type,
        text: recognized?.text ?? message.text,
        ...(recognized ? { media: recognized.media, mediaRecognition: recognized.recognition } : mediaMarker(message.type)),
        ...(message.quotedMessage ? { quotedMessage: message.quotedMessage } : {}), transport: "ilink_long_poll", transportVerified: true,
      },
      trust: actor === "user" ? "high" : "low", attention: actor === "user" ? "high" : "medium", timestamp: message.timestamp.getTime(),
    });
  }

  async #recognizeMedia(message: WeChatIncomingMessage): Promise<{ text: string; media: unknown; recognition: unknown } | undefined> {
    const kind = message.type === "image" ? "image" : message.type === "voice" ? "audio" : undefined;
    if (!kind) return undefined;
    const service = this.#mediaService();
    if (!service || !this.#gateway.downloadMedia) {
      return { text: message.text || `[${kind}]`, media: { kind }, recognition: { status: "unavailable" } };
    }
    try {
      const media = await this.#gateway.downloadMedia(message);
      if (!media || media.kind !== kind) throw new Error(`WeChat did not provide ${kind} data`);
      const result = await service.recognize(media as MediaData);
      return { text: result.text, media: result.media, recognition: { status: "success", provider: result.provider } };
    } catch (error) {
      return { text: message.text || `[${kind}]`, media: { kind }, recognition: mediaErrorResult(error) };
    }
  }

  #mediaService(): MediaService | undefined { return this.#mediaServiceOverride ?? getMedia(); }
  #requireMediaService(): MediaService {
    const service = this.#mediaService();
    if (!service) throw new Error("Media capability is not loaded");
    return service;
  }

  async #beginInteractiveLogin(interaction: Interaction): Promise<AdapterCallResult> {
    if (this.#loginStatus === "online" && !interaction.args.force) return this.#result(interaction.call_id, interaction.action, { status: "success", loginStatus: "online", account: this.#account });
    if (this.#loginTask) return this.#result(interaction.call_id, interaction.action, { status: "pending", loginStatus: this.#loginStatus, ...(this.#qrUrl ? { qrUrl: this.#qrUrl } : {}) });
    if (interaction.args.force !== undefined && typeof interaction.args.force !== "boolean") throw new Error("force must be boolean");
    this.#stopping = false;
    this.#qrUrl = undefined;
    this.#loginStatus = "requesting_qr";
    this.#setHealth("starting");
    let publishQr!: (url: string) => void;
    const qrReady = new Promise<string>((resolve) => { publishQr = resolve; });
    const callbacks: LoginCallbacks = {
      onQrUrl: (url) => { this.#qrUrl = url; this.#loginStatus = "waiting_scan"; publishQr(url); },
      onScanned: () => { this.#loginStatus = "scanned"; void this.#emitLifecycle("login.scanned", "微信二维码已扫描，等待用户确认", "low"); },
      onExpired: () => { this.#loginStatus = "requesting_qr"; this.#qrUrl = undefined; void this.#emitLifecycle("login.qr_expired", "微信登录二维码已过期，正在请求新链接", "low"); },
      onVerifyCode: (isRetry) => this.#waitForVerifyCode(isRetry),
    };
    this.#loginTask = this.#gateway.login(callbacks, interaction.args.force === true)
      .then((credentials) => this.#goOnline(credentials, "login_succeeded"))
      .catch((error) => this.#loginFailed(error))
      .finally(() => { this.#loginTask = null; });
    const outcome = await Promise.race([
      qrReady.then((qrUrl) => ({ kind: "qr" as const, qrUrl })),
      this.#loginTask.then(() => ({ kind: "done" as const })),
    ]);
    if (outcome.kind === "qr") return this.#result(interaction.call_id, interaction.action, { status: "pending", loginStatus: "waiting_scan", qrUrl: outcome.qrUrl });
    const online = this.#isOnline();
    return this.#result(interaction.call_id, interaction.action, online
      ? { status: "success", loginStatus: "online", account: this.#account }
      : { status: "error", loginStatus: this.#loginStatus, message: this.#health.detail ?? "WeChat login failed" });
  }

  async #goOnline(credentials: WeChatCredentials, reason: "session_restored" | "login_succeeded"): Promise<void> {
    if (this.#stopping) return;
    this.#account = { accountId: credentials.accountId, userId: credentials.userId };
    this.#qrUrl = undefined;
    this.#loginStatus = "online";
    await this.#gateway.start(this.#gatewayEvents());
    this.#setHealth("online");
    await this.#emitLifecycle(reason === "login_succeeded" ? "login.succeeded" : "session.restored", "微信登录成功，wechat-adapter 已上线", "high", { account: this.#account });
  }

  async #requireLogin(detail: string): Promise<void> {
    this.#loginStatus = "login_required";
    this.#setHealth("degraded", detail);
    await this.#emitLifecycle("login.required", "微信凭证缺失或无效；请在需要时调用 login 获取二维码链接", "high", { reason: detail });
  }

  async #loginFailed(error: unknown): Promise<void> {
    if (this.#stopping) return;
    const detail = errorMessage(error);
    this.#loginStatus = "failed";
    this.#qrUrl = undefined;
    this.#setHealth("degraded", detail);
    await this.#emitLifecycle("login.failed", "微信登录失败；适配器将保持静默，等待下一次显式 login", "high", { reason: detail });
  }

  #gatewayEvents(): WeChatGatewayEvents {
    return {
      onMessage: (message) => this.handleMessage(message),
      onSessionExpired: async () => {
        await this.#gateway.stop();
        await this.#requireLogin("WeChat session expired");
      },
      onSessionRestored: (credentials) => this.#goOnline(credentials, "session_restored"),
      onError: async (error) => {
        if (this.#stopping) return;
        if (this.#loginStatus === "login_required") return;
        this.#setHealth("degraded", errorMessage(error));
        await this.#emitLifecycle("adapter.error", "微信长轮询发生错误", "medium", { reason: errorMessage(error) });
      },
    };
  }

  #silentCallbacks(): LoginCallbacks {
    return {
      onQrUrl: () => { throw new Error("Stored credentials did not restore; explicit login is required"); },
      onScanned: () => {}, onExpired: () => {},
      onVerifyCode: async () => { throw new Error("Stored credentials require verification; explicit login is required"); },
    };
  }

  #waitForVerifyCode(isRetry: boolean): Promise<string> {
    this.#loginStatus = "verify_code_required";
    void this.#emitLifecycle("login.verify_code_required", isRetry ? "微信配对码不正确，请重新提交" : "微信要求提交手机上显示的配对码", "high", { isRetry });
    return new Promise<string>((resolve, reject) => { this.#pendingVerify = { resolve, reject }; });
  }

  #assertOnline(): void { if (this.#loginStatus !== "online") throw new Error(`wechat-adapter is not online (${this.#loginStatus})`); }
  #isOnline(): boolean { return this.#loginStatus === "online"; }
  #takeCachedMessage(messageId: string): WeChatIncomingMessage | undefined { this.#prune(Date.now()); return this.#messages.get(messageId)?.message; }
  #prune(now: number): void {
    for (const [id, expiresAt] of this.#seen) if (expiresAt <= now) this.#seen.delete(id);
    for (const [id, cached] of this.#messages) if (cached.expiresAt <= now) this.#messages.delete(id);
  }
  async #emitLifecycle(eventType: string, text: string, attention: Level, extra: Record<string, unknown> = {}): Promise<void> {
    await this.#emit({ id: randomUUID(), adapter_id: this.id, adapter_name: this.name, source: this.name, actor: "adapter", content: { eventType, text, ...extra }, trust: "high", attention, timestamp: Date.now() });
  }
  async #emit(observation: Observation): Promise<void> { await Promise.allSettled([...this.#listeners].map((listener) => listener(observation))); }
  #setHealth(status: AdapterHealth["status"], detail?: string): void { this.#health = { status, since: Date.now(), ...(this.#health.lastEventAt ? { lastEventAt: this.#health.lastEventAt } : {}), ...(detail ? { detail } : {}) }; }
  #result(call_id: string, action: string, content: unknown): AdapterCallResult { return { call_id, adapter_id: this.id, action, timestamp: Date.now(), content: JSON.stringify(content) }; }
}

function requireString(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`); return value.trim(); }
function optionalString(value: unknown, name: string): string | undefined { if (value === undefined) return undefined; return requireString(value, name); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function mediaMarker(type: string): { media: { kind: string }; mediaRecognition: { status: "unavailable" } } | {} {
  const kind = type === "video" ? "video" : type === "file" ? "file" : undefined;
  return kind ? { media: { kind }, mediaRecognition: { status: "unavailable" } } : {};
}
function wechatMediaConstraints() {
  return { kinds: ["image", "audio", "video", "file"] as const, mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "video/mp4", "application/octet-stream"], maxBytes: 20 * 1024 * 1024, image: { allowAnimated: true } };
}
export function createAdapter(): EnvAdapter { return new WeChatAdapter(); }
export default createAdapter;
