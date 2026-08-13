import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig, FeishuReceiveIdType } from "../config.ts";
import { resolveAppSecret } from "../config.ts";
import type { FeishuMessageEvent } from "../protocol.ts";

export interface SentFeishuMessage { messageId: string; chatId?: string }

export interface FeishuGateway {
  connect(onMessage: (event: FeishuMessageEvent) => void | Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
  connectionState(): string;
  sendText(receiveId: string, receiveIdType: FeishuReceiveIdType, text: string, uuid: string): Promise<SentFeishuMessage>;
  replyText(messageId: string, text: string, replyInThread: boolean, uuid: string): Promise<SentFeishuMessage>;
}

export class LarkSdkGateway implements FeishuGateway {
  readonly #config: FeishuConfig;
  readonly #client: Lark.Client;
  #ws: Lark.WSClient | null = null;

  constructor(config: FeishuConfig) {
    this.#config = config;
    const base = { appId: config.credentials.appId, appSecret: resolveAppSecret(config) };
    this.#client = new Lark.Client({
      ...base,
      appType: Lark.AppType.SelfBuild,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.error,
    });
  }

  async connect(onMessage: (event: FeishuMessageEvent) => void | Promise<void>): Promise<void> {
    if (this.#ws && this.connectionState() !== "idle" && this.connectionState() !== "failed") return;
    const base = { appId: this.#config.credentials.appId, appSecret: resolveAppSecret(this.#config) };
    this.#ws = new Lark.WSClient({
      ...base,
      loggerLevel: Lark.LoggerLevel.error,
      autoReconnect: this.#config.connection.autoReconnect,
      handshakeTimeoutMs: this.#config.connection.handshakeTimeoutMs,
      wsConfig: { pingTimeout: this.#config.connection.pingTimeoutSeconds },
      source: "tobe-feishu-adapter",
    });
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => onMessage(data as FeishuMessageEvent),
    });
    await this.#ws.start({ eventDispatcher: dispatcher });
  }

  async disconnect(): Promise<void> {
    this.#ws?.close({ force: false });
    this.#ws = null;
  }

  connectionState(): string { return this.#ws?.getConnectionStatus().state ?? "idle"; }

  async sendText(receiveId: string, receiveIdType: FeishuReceiveIdType, text: string, uuid: string): Promise<SentFeishuMessage> {
    const response = await this.#client.im.v1.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: receiveId, msg_type: "text", content: JSON.stringify({ text }), uuid },
    });
    assertResponse(response.code, response.msg);
    return { messageId: response.data?.message_id ?? uuid, ...(response.data?.chat_id ? { chatId: response.data.chat_id } : {}) };
  }

  async replyText(messageId: string, text: string, replyInThread: boolean, uuid: string): Promise<SentFeishuMessage> {
    const response = await this.#client.im.v1.message.reply({
      path: { message_id: messageId },
      data: { msg_type: "text", content: JSON.stringify({ text }), reply_in_thread: replyInThread, uuid },
    });
    assertResponse(response.code, response.msg);
    return { messageId: response.data?.message_id ?? uuid, ...(response.data?.chat_id ? { chatId: response.data.chat_id } : {}) };
  }
}

function assertResponse(code?: number, message?: string): void {
  if (code !== undefined && code !== 0) throw new Error(`Feishu API error ${code}: ${message ?? "unknown error"}`);
}
