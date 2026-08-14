import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig, FeishuReceiveIdType } from "../config.ts";
import { resolveAppSecret } from "../config.ts";
import type { FeishuMessageEvent } from "../protocol.ts";

export interface SentFeishuMessage { messageId: string; chatId?: string }
export type FeishuConnectionEvent =
  | { state: "connected" | "reconnecting" | "reconnected" }
  | { state: "failed"; error: Error };
export type FeishuConnectionListener = (event: FeishuConnectionEvent) => void | Promise<void>;

export interface FeishuGateway {
  connect(
    onMessage: (event: FeishuMessageEvent) => void | Promise<void>,
    onConnectionEvent?: FeishuConnectionListener,
  ): Promise<void>;
  disconnect(): Promise<void>;
  connectionState(): string;
  sendText(receiveId: string, receiveIdType: FeishuReceiveIdType, text: string, uuid: string): Promise<SentFeishuMessage>;
  replyText(messageId: string, text: string, replyInThread: boolean, uuid: string): Promise<SentFeishuMessage>;
}

interface WsClientLike {
  start(params: { eventDispatcher: Lark.EventDispatcher }): Promise<void>;
  close(params?: { force?: boolean }): void;
  getConnectionStatus(): { state: string };
}

type WsClientFactory = (params: ConstructorParameters<typeof Lark.WSClient>[0]) => WsClientLike;
export interface LarkSdkGatewayOptions {
  createWsClient?: WsClientFactory;
  /** 覆盖首次连接的总等待时间，仅用于测试或特殊网络环境。 */
  connectTimeoutMs?: number;
}

export class LarkSdkGateway implements FeishuGateway {
  readonly #config: FeishuConfig;
  readonly #client: Lark.Client;
  readonly #createWsClient: WsClientFactory;
  readonly #connectTimeoutMs: number;
  #ws: WsClientLike | null = null;
  #connectTask: Promise<void> | null = null;
  #rejectPendingConnect: ((error: Error) => void) | null = null;

  constructor(config: FeishuConfig, options: LarkSdkGatewayOptions = {}) {
    this.#config = config;
    this.#createWsClient = options.createWsClient ?? ((params) => new Lark.WSClient(params));
    this.#connectTimeoutMs = options.connectTimeoutMs
      ?? Math.max(config.connection.handshakeTimeoutMs * 2, 15_000);
    const base = { appId: config.credentials.appId, appSecret: resolveAppSecret(config) };
    this.#client = new Lark.Client({
      ...base,
      appType: Lark.AppType.SelfBuild,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.error,
    });
  }

  async connect(
    onMessage: (event: FeishuMessageEvent) => void | Promise<void>,
    onConnectionEvent?: FeishuConnectionListener,
  ): Promise<void> {
    if (this.connectionState() === "connected") return;
    if (this.#connectTask) return this.#connectTask;
    const base = { appId: this.#config.credentials.appId, appSecret: resolveAppSecret(this.#config) };
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => onMessage(data as FeishuMessageEvent),
    });
    this.#connectTask = new Promise<void>((resolve, reject) => {
      let initialSettled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const settleReady = () => {
        if (initialSettled) return;
        initialSettled = true;
        clearTimeout(timeout);
        this.#rejectPendingConnect = null;
        resolve();
      };
      const settleError = (error: Error) => {
        void onConnectionEvent?.({ state: "failed", error });
        if (initialSettled) return;
        initialSettled = true;
        clearTimeout(timeout);
        this.#rejectPendingConnect = null;
        reject(error);
      };
      timeout = setTimeout(() => {
        this.#ws?.close({ force: true });
        settleError(new Error(`Feishu connection was not ready within ${this.#connectTimeoutMs}ms`));
      }, this.#connectTimeoutMs);
      this.#rejectPendingConnect = settleError;
      this.#ws = this.#createWsClient({
        ...base,
        loggerLevel: Lark.LoggerLevel.error,
        autoReconnect: this.#config.connection.autoReconnect,
        handshakeTimeoutMs: this.#config.connection.handshakeTimeoutMs,
        wsConfig: { pingTimeout: this.#config.connection.pingTimeoutSeconds },
        source: "tobe-feishu-adapter",
        onReady: () => { void onConnectionEvent?.({ state: "connected" }); settleReady(); },
        onError: settleError,
        onReconnecting: () => { void onConnectionEvent?.({ state: "reconnecting" }); },
        onReconnected: () => { void onConnectionEvent?.({ state: "reconnected" }); },
      });
      void this.#ws.start({ eventDispatcher: dispatcher }).catch((error: unknown) => {
        settleError(asError(error));
      });
    }).finally(() => { this.#connectTask = null; });
    return this.#connectTask;
  }

  async disconnect(): Promise<void> {
    this.#rejectPendingConnect?.(new Error("Feishu connection was closed before it became ready"));
    this.#rejectPendingConnect = null;
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

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
