import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  AdapterHealth,
  EnvAdapter,
  ObservationListener,
  Unsubscribe,
} from "../../adapter.ts";
import type { AdapterCallResult, Interaction, Level, Observation, ObserveRequest } from "../../type.ts";
import { directlyAddressesBot, ParticipationClassifier } from "./classifier.ts";
import { loadConfig, type IIroseConfig } from "./config.ts";
import { eventId, type IIroseEvent } from "./protocol.ts";
import { WelcomePlugin } from "./plugins/welcome.ts";
import { IIroseClient } from "./scripts/client.ts";
import { runCommand } from "./scripts/help.ts";
import { listen } from "./scripts/listen.ts";
import { login } from "./scripts/login.ts";
import { logout } from "./scripts/logout.ts";
import { sendMessage, type SendMessageArgs } from "./scripts/send-message.ts";
import { IIROSE_ACTIONS } from "./tools/index.ts";
import { LocalResponseGuard } from "./local-response.ts";
import { classifyIIroseActor } from "./actor.ts";
import { MusicPlugin } from "./plugins/music.ts";
import { requestMusic } from "./tools/music.ts";
import { MonthlyMessageLog, type MessageLogEntry } from "./message-log.ts";
import { ActivePlugin, type ActiveLevel } from "./plugins/active.ts";
import { RoomPlugin } from "./plugins/room.ts";
import { likeUser, switchRoom } from "./scripts/switch-room.ts";
import { getMedia, mediaErrorResult, parseMediaInput } from "../../../media/index.ts";
import type { MediaService, ResolvedMedia } from "../../../media/type.ts";
import { uploadIIroseMedia } from "./scripts/upload-media.ts";
import { sendIIroseAudioUrl } from "./scripts/send-audio.ts";

export interface IIroseAdapterOptions { configPath?: string; config?: IIroseConfig; mediaService?: MediaService }

export class IIroseAdapter implements EnvAdapter {
  readonly id = randomUUID().replaceAll("-", "").slice(0, 10);
  readonly name = "iirose-adapter";
  readonly permission: Level = "medium";
  readonly autoStart: boolean;

  readonly #config: IIroseConfig;
  readonly #client = new IIroseClient();
  readonly #classifier: ParticipationClassifier;
  readonly #welcome: WelcomePlugin;
  readonly #music: MusicPlugin;
  readonly #active: ActivePlugin;
  readonly #room: RoomPlugin;
  readonly #messageLog: MonthlyMessageLog;
  readonly #localResponses = new LocalResponseGuard();
  readonly #mediaServiceOverride: MediaService | undefined;
  readonly #listeners = new Set<ObservationListener>();
  #health: AdapterHealth = { status: "stopped", since: Date.now() };
  #disposeListen: Unsubscribe | null = null;
  #disposeClose: Unsubscribe | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #intentionalStop = false;

  constructor(options: IIroseAdapterOptions = {}) {
    this.#config = options.config ?? loadConfig(options.configPath);
    this.autoStart = this.#config.enabled && this.#config.autoStart;
    this.#classifier = new ParticipationClassifier();
    this.#welcome = new WelcomePlugin(this.#config.plugins.welcome, this.#config.credentials.uid);
    this.#music = new MusicPlugin(this.#config);
    this.#active = new ActivePlugin(this.#config.plugins.active);
    this.#room = new RoomPlugin(this.#config.plugins.room);
    this.#messageLog = new MonthlyMessageLog(this.#config.logging.directory);
    this.#mediaServiceOverride = options.mediaService;
  }

  async start(): Promise<void> {
    if (this.#client.connected) return;
    if (!this.#config.enabled) throw new Error("iirose-adapter is disabled in config.json");
    this.#intentionalStop = false;
    this.#setHealth("starting");
    try {
      await login(this.#client, this.#config);
      this.#disposeListen = listen(this.#client, this.#config, (event) => this.#onEvent(event));
      this.#disposeClose = this.#client.onClose(() => this.#onClose());
      this.#heartbeat = setInterval(
        () => void this.#client.send("").catch(() => this.#onClose()),
        this.#config.connection.heartbeatIntervalMs,
      );
      this.#reconnectAttempts = 0;
      this.#setHealth("online");
      await this.#emitLifecycle("adapter.started", "IIROSE adapter started");
    } catch (error) {
      this.#setHealth("error", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#intentionalStop = true;
    this.#clearRuntime();
    await logout(this.#client);
    await this.#emitLifecycle("adapter.stopped", "IIROSE adapter stopped");
    this.#setHealth("stopped");
  }

  async observe(request: ObserveRequest): Promise<AdapterCallResult> {
    switch (request.action) {
      case "status":
        return this.#result(request.call_id, request.action, { status: "success", health: this.health() });
      case "logs":
        return this.#result(request.call_id, request.action, {
          status: "success",
          enabled: true,
          file: this.#messageLog.fileName(),
          directory: "Adapter data/logs",
        });
      case "history": {
        const start = request.args.start;
        const end = request.args.end;
        if (typeof start !== "number" || typeof end !== "number") {
          return this.#result(request.call_id, request.action, { status: "error", message: "history requires numeric start and end" });
        }
        const messages = await this.#messageLog.range(start, end);
        return this.#result(request.call_id, request.action, {
          status: "success", file: this.#messageLog.fileName(), start, end, messages,
        });
      }
      default:
        return this.#result(request.call_id, request.action, { status: "error", message: `Unsupported observe action: ${request.action}` });
    }
  }

  async interact(interaction: Interaction): Promise<AdapterCallResult> {
    try {
      switch (interaction.action) {
        case "login":
          await this.start();
          return this.#result(interaction.call_id, interaction.action, { status: "success", adapter_id: this.id });
        case "logout":
          await this.stop();
          return this.#result(interaction.call_id, interaction.action, { status: "success", message: "logged out" });
        case "send_message": {
          const content = interaction.args.content;
          const userId = interaction.args.userId;
          if (typeof content !== "string" || (userId !== undefined && typeof userId !== "string")) {
            throw new Error("send_message requires string content and optional string userId");
          }
          const args: SendMessageArgs = userId === undefined ? { content } : { content, userId };
          return this.#result(interaction.call_id, interaction.action, {
            status: "success",
            ...(await sendMessage(this.#client, this.#config, args)),
          });
        }
        case "send_media": {
          if (!this.#client.connected) throw new Error("IIROSE adapter is not connected");
          const service = this.#mediaServiceOverride ?? getMedia();
          if (!service) throw new Error("Media capability is not loaded");
          const resolved = await service.resolve(parseMediaInput(interaction.args.media), {
            kinds: ["image", "audio"], maxBytes: this.#config.media.maxBytes,
          });
          const caption = interaction.args.caption;
          if (caption !== undefined && typeof caption !== "string") throw new Error("caption must be a string");
          const uploaded = await uploadIIroseMedia(this.#config, resolved);
          const delivery = await this.#sendUploadedMedia(resolved, uploaded.url, caption?.trim());
          return this.#result(interaction.call_id, interaction.action, {
            status: "success", media: resolved.artifact, url: uploaded.url, delivery,
          });
        }
        case "request_music": {
          const name = interaction.args.name;
          if (typeof name !== "string" || !name.trim()) throw new Error("request_music requires a non-empty string name");
          return this.#result(interaction.call_id, interaction.action, {
            status: "success",
            song: await requestMusic(this.#client, this.#config, name),
          });
        }
        case "set_active": {
          const level = this.#parseActiveLevel(interaction.args.level);
          this.#active.setLevel(level);
          return this.#result(interaction.call_id, interaction.action, { status: "success", level });
        }
        case "switch_room": {
          const roomId = this.#requiredString(interaction.args.roomId, "roomId");
          const password = interaction.args.password;
          if (password !== undefined && typeof password !== "string") throw new Error("password must be a string");
          await this.#switchRoom(roomId, password);
          return this.#result(interaction.call_id, interaction.action, { status: "success", roomId });
        }
        case "set_follow": {
          if (typeof interaction.args.follow !== "boolean") throw new Error("follow must be boolean");
          this.#room.setFollow(interaction.args.follow);
          return this.#result(interaction.call_id, interaction.action, { status: "success", follow: this.#room.follow });
        }
        case "like_user": {
          const userId = this.#requiredString(interaction.args.userId, "userId");
          const message = interaction.args.message;
          if (message !== undefined && typeof message !== "string") throw new Error("message must be a string");
          if (userId === this.#config.credentials.uid || this.#config.adminsIds.includes(userId)) {
            throw new Error("like_user only accepts ordinary users");
          }
          await likeUser(this.#client, userId, message);
          return this.#result(interaction.call_id, interaction.action, { status: "success", userId });
        }
        default:
          throw new Error(`Unsupported IIROSE action: ${interaction.action}`);
      }
    } catch (error) {
      const mediaError = mediaErrorResult(error);
      return this.#result(interaction.call_id, interaction.action,
        mediaError.code !== "MEDIA_INTERNAL_ERROR"
          ? mediaError
          : { status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  health(): AdapterHealth { return { ...this.#health }; }

  subscribe(listener: ObservationListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSkillPaths(): readonly string[] {
    return [fileURLToPath(new URL("./SKILL.md", import.meta.url))];
  }

  getActions() { return IIROSE_ACTIONS; }

  async #onEvent(event: IIroseEvent): Promise<void> {
    const isAdmin = this.#config.adminsIds.includes(event.userId);
    const source = event.type === "message.private" ? `private:${event.userId}` : (event.roomId ?? this.#config.credentials.roomId);
    this.#health = { ...this.#health, lastEventAt: Date.now() };

    // 本地命令/插件发送结果的聊天室回显不属于新的环境感知。
    if (this.#localResponses.consume(event)) return;

    if (event.type === "room.switch") {
      if (event.targetRoomId && this.#room.shouldFollow(isAdmin)) await this.#switchRoom(event.targetRoomId);
      return;
    }

    let history: MessageLogEntry[] = [];
    let baseTrigger = isAdmin;
    if (event.type === "message.public" || event.type === "message.private") {
      const mentioned = directlyAddressesBot(
        event.content, this.#config.credentials.username, this.#config.nickname, event.reply,
      );
      baseTrigger ||= mentioned;
      await this.#messageLog.append({
        receivedAt: Date.now(), timestamp: event.timestamp, source, eventType: event.type,
        userId: event.userId, username: event.username, text: event.content,
        ...(event.messageId ? { messageId: event.messageId } : {}),
        ...(event.roomId ? { roomId: event.roomId } : {}),
        isAdmin, mentioned, reply: event.reply === true,
      });
    }

    // 本地降级路由先于 trust 窗口和 Observation；命中后不影响 Engine 状态。
    if (event.type.startsWith("message.")) {
      const command = await runCommand(
        event.content,
        this.#config.commands.prefix,
        [...new Set([...this.#config.commands.whitelist, "active", "room", "follow"])],
        {
          status: () => `iirose-adapter: ${this.#health.status}; active=${this.#active.level}; room=${this.#config.credentials.roomId}; follow=${this.#room.follow}`,
          pluginCommands: () => this.#pluginHelp(),
          active: (level) => {
            const parsed = this.#parseActiveLevel(level);
            this.#active.setLevel(parsed);
            return `主动响应等级已切换为 ${parsed}`;
          },
          room: async (roomId) => {
            await this.#switchRoom(this.#requiredString(roomId, "roomId"));
            return `已切换至房间 ${roomId}`;
          },
          follow: (value) => {
            const parsed = this.#parseBoolean(value, "follow");
            this.#room.setFollow(parsed);
            return `跟随管理员切房已${parsed ? "开启" : "关闭"}`;
          },
        },
        !this.#config.commands.adminOnly || isAdmin,
      );
      if (command.handled) {
        if ((!this.#config.commands.adminOnly || isAdmin) && command.response) {
          const response: SendMessageArgs = event.type === "message.private"
            ? { content: command.response, userId: event.userId }
            : { content: command.response };
          await this.#safeSend(response);
        }
        return;
      }
    }

    const plugin = this.#welcome.handle(event);
    if (plugin.handled) {
      if (plugin.response) await this.#safeSend(plugin.response);
      return;
    }

    const music = this.#music.handle(event, isAdmin);
    if (music.handled) {
      if (!music.songName) {
        await this.#safeSend({ content: "请在点歌命令后提供歌名。" });
      } else {
        try { await requestMusic(this.#client, this.#config, music.songName); }
        catch (error) {
          await this.#safeSend({ content: `点歌失败：${error instanceof Error ? error.message : String(error)}` });
        }
      }
      return;
    }

    if (event.type !== "message.public" && event.type !== "message.private") return;
    const isPrivate = event.type === "message.private";
    const triggered = isPrivate ? isAdmin : this.#active.shouldTrigger(source, baseTrigger, Date.now());
    if (!triggered) return;
    history = await this.#messageLog.recent(10, source);
    const levels = this.#classifier.assess(history, { triggered, private: isPrivate, isAdmin });
    if (levels.attention === "off") return;

    const observation: Observation = {
      id: eventId(),
      adapter_id: this.id,
      adapter_name: this.name,
      source,
      actor: classifyIIroseActor(event, this.#config),
      content: {
        eventType: event.type,
        userId: event.userId,
        username: event.username,
        text: event.content,
        ...(event.roomId ? { roomId: event.roomId } : {}),
        ...(event.messageId ? { messageId: event.messageId } : {}),
        history,
        trigger: { direct: baseTrigger, activeLevel: this.#active.level },
        ...(this.#config.logging.includeRawFrames ? { rawFrame: event.raw } : {}),
      },
      trust: levels.trust,
      attention: levels.attention,
      timestamp: event.timestamp,
    };
    await this.#emit(observation);
  }

  async #safeSend(args: SendMessageArgs): Promise<void> {
    try {
      const sent = await sendMessage(this.#client, this.#config, args);
      this.#localResponses.remember(sent.messageId, args.content);
    }
    catch (error) { this.#setHealth("degraded", error instanceof Error ? error.message : String(error)); }
  }

  async #sendUploadedMedia(media: ResolvedMedia, url: string, caption?: string): Promise<"image" | "audio_url"> {
    if (media.artifact.kind === "image") {
      const content = `${caption ? `${caption}\n` : ""}[${url}#e]`;
      await sendMessage(this.#client, this.#config, { content });
      return "image";
    }
    if (media.artifact.kind !== "audio") throw new Error(`IIROSE cannot send ${media.artifact.kind} media`);
    return sendIIroseAudioUrl(this.#client, this.#config, url);
  }

  #pluginHelp(): readonly string[] {
    if (!this.#config.plugins.music.enabled) return [];
    const prefix = this.#config.plugins.music.commands.prefix === "{name}"
      ? `@${this.#config.credentials.username} / ${this.#config.nickname || "nickname"}`
      : this.#config.plugins.music.commands.prefix;
    const whiteList = this.#config.plugins.music.commands.whiteList;
    const commands = typeof whiteList === "string" ? [whiteList] : whiteList;
    return commands.map((command) => `${prefix}${command}<歌名> — 点播音乐`);
  }

  async #switchRoom(roomId: string, password?: string): Promise<void> {
    if (!this.#room.enabled) throw new Error("room plugin is disabled");
    await switchRoom(this.#client, roomId, password);
    this.#config.credentials.roomId = roomId;
  }

  #parseActiveLevel(value: unknown): ActiveLevel {
    if (value === "off" || value === "low" || value === "medium" || value === "high") return value;
    throw new Error("level must be off, low, medium, or high");
  }

  #parseBoolean(value: unknown, name: string): boolean {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new Error(`${name} must be true or false`);
  }

  #requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
    return value.trim();
  }

  async #emitLifecycle(type: "adapter.started" | "adapter.stopped", content: string): Promise<void> {
    await this.#emit({
      id: eventId(), adapter_id: this.id, adapter_name: this.name,
      source: this.name,
      actor: "adapter",
      content: { eventType: type, text: content },
      trust: "high", attention: "high", timestamp: Date.now(),
    });
  }

  async #emit(observation: Observation): Promise<void> {
    await Promise.allSettled([...this.#listeners].map((listener) => listener(observation)));
  }


  #onClose(): void {
    if (this.#intentionalStop || this.#reconnectTimer) return;
    this.#clearRuntime(false);
    this.#setHealth("degraded", "WebSocket connection closed");
    const { reconnect, maxReconnectAttempts } = this.#config.connection;
    if (!reconnect || (maxReconnectAttempts > 0 && this.#reconnectAttempts >= maxReconnectAttempts)) return;
    const delay = Math.min(
      this.#config.connection.reconnectInitialDelayMs * 2 ** this.#reconnectAttempts,
      this.#config.connection.reconnectMaxDelayMs,
    );
    this.#reconnectAttempts += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.start().catch(() => this.#onClose());
    }, delay);
  }

  #clearRuntime(clearReconnect = true): void {
    this.#disposeListen?.(); this.#disposeListen = null;
    this.#disposeClose?.(); this.#disposeClose = null;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    if (clearReconnect && this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (clearReconnect) this.#reconnectTimer = null;
  }

  #setHealth(status: AdapterHealth["status"], detail?: string): void {
    this.#health = {
      status,
      since: Date.now(),
      ...(this.#health.lastEventAt ? { lastEventAt: this.#health.lastEventAt } : {}),
      ...(detail ? { detail } : {}),
    };
  }

  #result(call_id: string, action: string, content: unknown): AdapterCallResult {
    return {
      call_id,
      adapter_id: this.id,
      action,
      timestamp: Date.now(),
      content: JSON.stringify(content),
    };
  }
}

export function createAdapter(): EnvAdapter { return new IIroseAdapter(); }
export default createAdapter;
