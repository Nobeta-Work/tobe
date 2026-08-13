import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  AdapterHealth,
  EnvAdapter,
  ObservationListener,
  Unsubscribe,
} from "../../adapter.ts";
import type { AdapterCallResult, Interaction, Level, Observation, ObserveRequest } from "../../type.ts";
import { ParticipationClassifier } from "./classifier.ts";
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

export interface IIroseAdapterOptions { configPath?: string; config?: IIroseConfig }

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
  readonly #localResponses = new LocalResponseGuard();
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
    this.#classifier = new ParticipationClassifier(this.#config.assessment);
    this.#welcome = new WelcomePlugin(this.#config.plugins.welcome, this.#config.credentials.uid);
    this.#music = new MusicPlugin(this.#config);
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
          enabled: this.#config.logging.enabled,
          implemented: false,
          message: "Persistent logs are pending.",
        });
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
        case "request_music": {
          const name = interaction.args.name;
          if (typeof name !== "string" || !name.trim()) throw new Error("request_music requires a non-empty string name");
          return this.#result(interaction.call_id, interaction.action, {
            status: "success",
            song: await requestMusic(this.#client, this.#config, name),
          });
        }
        default:
          throw new Error(`Unsupported IIROSE action: ${interaction.action}`);
      }
    } catch (error) {
      return this.#result(interaction.call_id, interaction.action, {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
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

    // 本地降级路由先于 trust 窗口和 Observation；命中后不影响 Engine 状态。
    if (event.type.startsWith("message.")) {
      const command = await runCommand(
        event.content,
        this.#config.commands.prefix,
        this.#config.commands.whitelist,
        {
          status: () => `iirose-adapter: ${this.#health.status}`,
          pluginCommands: () => this.#pluginHelp(),
        },
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

    // 参与窗口使用本机接收时间，避免远端时间单位或伪造时间戳影响洪泛判断。
    const levels = this.#classifier.assess(source, isAdmin, Date.now());

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

  #pluginHelp(): readonly string[] {
    if (!this.#config.plugins.music.enabled) return [];
    const prefix = this.#config.plugins.music.commands.prefix === "{name}"
      ? `@${this.#config.credentials.username} / ${this.#config.nickname || "nickname"}`
      : this.#config.plugins.music.commands.prefix;
    const whiteList = this.#config.plugins.music.commands.whiteList;
    const commands = typeof whiteList === "string" ? [whiteList] : whiteList;
    return commands.map((command) => `${prefix}${command}<歌名> — 点播音乐`);
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
