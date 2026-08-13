import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AdapterHealth, EnvAdapter, ObservationListener, Unsubscribe } from "../../adapter.ts";
import type { AdapterCallResult, Interaction, Level, Observation, ObserveRequest } from "../../type.ts";
import { classifyFeishuActor } from "./actor.ts";
import { FeishuParticipationClassifier } from "./classifier.ts";
import { assertFeishuConfigured, feishuConfigurationError, loadConfig, type FeishuConfig, type FeishuReceiveIdType } from "./config.ts";
import { eventTimestamp, observationId, parseMessageContent, type FeishuMessageEvent } from "./protocol.ts";
import { LarkSdkGateway, type FeishuGateway } from "./scripts/client.ts";
import { runCommand } from "./scripts/help.ts";
import { listen } from "./scripts/listen.ts";
import { sendMessage } from "./scripts/send-message.ts";
import { FEISHU_ACTIONS } from "./tools/index.ts";

export interface FeishuAdapterOptions {
  configPath?: string;
  config?: FeishuConfig;
  gateway?: FeishuGateway;
}

export class FeishuAdapter implements EnvAdapter {
  readonly id = randomUUID().replaceAll("-", "").slice(0, 10);
  readonly name = "feishu-adapter";
  readonly permission: Level = "medium";
  readonly autoStart: boolean;

  readonly #config: FeishuConfig;
  #gateway: FeishuGateway | undefined;
  readonly #classifier: FeishuParticipationClassifier;
  readonly #listeners = new Set<ObservationListener>();
  readonly #seen = new Map<string, number>();
  #health: AdapterHealth = { status: "stopped", since: Date.now() };

  constructor(options: FeishuAdapterOptions = {}) {
    this.#config = options.config ?? loadConfig(options.configPath);
    const configurationError = feishuConfigurationError(this.#config);
    this.autoStart = this.#config.enabled && this.#config.autoStart && !configurationError;
    this.#gateway = options.gateway;
    if (configurationError) this.#health = { status: "stopped", since: Date.now(), detail: configurationError };
    this.#classifier = new FeishuParticipationClassifier(this.#config.assessment);
  }

  async start(): Promise<void> {
    if (!this.#config.enabled) throw new Error("feishu-adapter is disabled in config.json");
    assertFeishuConfigured(this.#config);
    if (this.#health.status === "starting" || this.#health.status === "online") return;
    this.#setHealth("starting");
    try {
      await listen(this.#getGateway(), (event) => this.handleMessageEvent(event));
      this.#setHealth("online");
      await this.#emitLifecycle("adapter.started", "Feishu adapter started");
    } catch (error) {
      this.#setHealth("error", errorMessage(error));
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.#gateway?.disconnect();
    await this.#emitLifecycle("adapter.stopped", "Feishu adapter stopped");
    this.#setHealth("stopped");
  }

  async observe(request: ObserveRequest): Promise<AdapterCallResult> {
    if (request.action === "status") {
      return this.#result(request.call_id, request.action, {
        status: "success", health: this.health(), configured: !feishuConfigurationError(this.#config),
        connection: this.#gateway?.connectionState() ?? "idle",
      });
    }
    return this.#result(request.call_id, request.action, { status: "error", message: `Unsupported observe action: ${request.action}` });
  }

  async interact(interaction: Interaction): Promise<AdapterCallResult> {
    try {
      if (interaction.action === "connect") {
        await this.start();
        return this.#result(interaction.call_id, interaction.action, { status: "success", adapter_id: this.id });
      }
      if (interaction.action === "disconnect") {
        await this.stop();
        return this.#result(interaction.call_id, interaction.action, { status: "success" });
      }
      if (interaction.action === "send_message" || interaction.action === "reply_message") {
        const content = requireString(interaction.args.content, "content");
        const receiveId = optionalString(interaction.args.receiveId, "receiveId");
        const messageId = optionalString(interaction.args.messageId, "messageId");
        if (interaction.action === "send_message" && !receiveId) throw new Error("send_message requires receiveId");
        if (interaction.action === "reply_message" && !messageId) throw new Error("reply_message requires messageId");
        const receiveIdType = optionalReceiveIdType(interaction.args.receiveIdType);
        const replyInThread = interaction.args.replyInThread;
        if (replyInThread !== undefined && typeof replyInThread !== "boolean") throw new Error("replyInThread must be boolean");
        assertFeishuConfigured(this.#config);
        const sent = await sendMessage(this.#getGateway(), this.#config, {
          content,
          ...(receiveId ? { receiveId } : {}),
          ...(receiveIdType ? { receiveIdType } : {}),
          ...(messageId ? { messageId } : {}),
          ...(typeof replyInThread === "boolean" ? { replyInThread } : {}),
        });
        return this.#result(interaction.call_id, interaction.action, { status: "success", ...sent });
      }
      throw new Error(`Unsupported Feishu action: ${interaction.action}`);
    } catch (error) {
      return this.#result(interaction.call_id, interaction.action, { status: "error", message: errorMessage(error) });
    }
  }

  health(): AdapterHealth { return { ...this.#health }; }

  subscribe(listener: ObservationListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSkillPaths(): readonly string[] { return [fileURLToPath(new URL("./SKILL.md", import.meta.url))]; }
  getActions() { return FEISHU_ACTIONS; }

  /** 公开的协议入口便于 transport 与离线测试复用；不会绕过正常路由。 */
  async handleMessageEvent(event: FeishuMessageEvent): Promise<void> {
    const now = Date.now();
    if (this.#isDuplicate(observationId(event), now)) return;
    const message = event.message;
    const direct = message.chat_type === "p2p";
    if ((direct && !this.#config.receive.directMessages) || (!direct && !this.#config.receive.groupMessages)) return;
    if (this.#config.receive.denyChats.includes(message.chat_id)) return;
    if (this.#config.receive.allowChats.length && !this.#config.receive.allowChats.includes(message.chat_id)) return;
    if (!this.#config.receive.messageTypes.includes(message.message_type)) return;

    const openId = event.sender.sender_id?.open_id;
    const owner = Boolean(openId && this.#config.identity.adminsIds.includes(openId));
    const actor = classifyFeishuActor(event, this.#config);
    if (this.#config.receive.ignoreBotMessages && actor === "assistant") return;
    const botMentions = (message.mentions ?? []).filter((mention) => isBotMention(mention, this.#config));
    const mentioned = botMentions.length > 0;
    const parsed = parseMessageContent(message.message_type, message.content);
    const source = direct ? `p2p:${openId ?? message.chat_id}` : `chat:${message.chat_id}`;
    this.#health = { ...this.#health, lastEventAt: now };

    if (this.#config.commands.enabled && parsed.text) {
      const commandText = mentioned ? removeMentionKeys(parsed.text, botMentions) : parsed.text;
      const command = runCommand(commandText, this.#config.nickname, mentioned ? "" : this.#config.commands.prefix, this.#config.commands.whiteList, () => `feishu-adapter: ${this.#health.status}`);
      if (command.handled) {
        if ((!this.#config.commands.adminOnly || owner) && command.response) {
          try {
            await sendMessage(this.#getGateway(), this.#config, { content: command.response, messageId: message.message_id, replyInThread: false });
          } catch (error) { this.#setHealth("degraded", errorMessage(error)); }
        }
        return;
      }
    }

    if (!direct && this.#config.receive.requireMentionInGroup && !mentioned) return;
    const levels = this.#classifier.assess(source, owner, mentioned, direct, now);
    const observation: Observation = {
      id: observationId(event), adapter_id: this.id, adapter_name: this.name, source, actor,
      content: {
        eventType: "message.received",
        ...(event.event_id ? { eventId: event.event_id } : {}),
        ...(event.tenant_key ? { tenantKey: event.tenant_key } : {}),
        chatType: message.chat_type, chatId: message.chat_id, messageId: message.message_id,
        ...(message.root_id ? { rootId: message.root_id } : {}),
        ...(message.parent_id ? { parentId: message.parent_id } : {}),
        ...(message.thread_id ? { threadId: message.thread_id } : {}),
        messageType: message.message_type,
        ...(parsed.text !== undefined ? { text: parsed.text } : {}),
        mentions: message.mentions ?? [], sender: { senderType: event.sender.sender_type, ...(event.sender.sender_id ?? {}) },
        transport: "long_connection", transportVerified: true,
        ...(this.#config.logging.includeRawEvents ? { rawEvent: event } : {}),
      },
      trust: levels.trust, attention: levels.attention, timestamp: eventTimestamp(event),
    };
    await this.#emit(observation);
  }

  #isDuplicate(id: string, now: number): boolean {
    for (const [key, expires] of this.#seen) if (expires <= now) this.#seen.delete(key);
    if (this.#seen.has(id)) return true;
    this.#seen.set(id, now + this.#config.events.dedupeTtlMs);
    return false;
  }

  async #emitLifecycle(eventType: string, text: string): Promise<void> {
    await this.#emit({ id: randomUUID(), adapter_id: this.id, adapter_name: this.name, source: this.name, actor: "adapter", content: { eventType, text }, trust: "high", attention: "high", timestamp: Date.now() });
  }

  async #emit(observation: Observation): Promise<void> {
    await Promise.allSettled([...this.#listeners].map((listener) => listener(observation)));
  }

  #setHealth(status: AdapterHealth["status"], detail?: string): void {
    this.#health = { status, since: Date.now(), ...(this.#health.lastEventAt ? { lastEventAt: this.#health.lastEventAt } : {}), ...(detail ? { detail } : {}) };
  }

  #getGateway(): FeishuGateway {
    assertFeishuConfigured(this.#config);
    return this.#gateway ??= new LarkSdkGateway(this.#config);
  }

  #result(call_id: string, action: string, content: unknown): AdapterCallResult {
    return { call_id, adapter_id: this.id, action, timestamp: Date.now(), content: JSON.stringify(content) };
  }
}

function removeMentionKeys(text: string, mentions: readonly { key: string }[]): string {
  return mentions.reduce((value, mention) => value.replaceAll(mention.key, ""), text).trim();
}

function isBotMention(mention: { id: { open_id?: string }; name: string }, config: FeishuConfig): boolean {
  if (config.identity.botOpenId) return mention.id.open_id === config.identity.botOpenId;
  return mention.name.trim().toLocaleLowerCase() === config.nickname.trim().toLocaleLowerCase();
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalReceiveIdType(value: unknown): FeishuReceiveIdType | undefined {
  if (value === undefined) return undefined;
  const allowed: FeishuReceiveIdType[] = ["open_id", "user_id", "union_id", "email", "chat_id"];
  if (typeof value !== "string" || !allowed.includes(value as FeishuReceiveIdType)) throw new Error("receiveIdType is invalid");
  return value as FeishuReceiveIdType;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function createAdapter(): EnvAdapter { return new FeishuAdapter(); }
export default createAdapter;
