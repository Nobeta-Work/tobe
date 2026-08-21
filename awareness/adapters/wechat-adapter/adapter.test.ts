import assert from "node:assert/strict";
import test from "node:test";
import type { MediaData, MediaMetadata } from "../../../media/type.ts";
import { WeChatAdapter } from "./ADAPTER.ts";
import type { WeChatConfig } from "./config.ts";
import type { WeChatIncomingMessage } from "./protocol.ts";
import type { LoginCallbacks, WeChatCredentials, WeChatGateway, WeChatGatewayEvents } from "./scripts/client.ts";
import { createVoiceItem, sendWeChatVoice } from "./scripts/client.ts";

const config: WeChatConfig = {
  enabled: true, autoStart: true, storageDir: "unused", logLevel: "silent", botAgent: "test",
  receive: { messageTypes: ["text"] },
  events: { dedupeTtlMs: 60_000, messageCacheTtlMs: 60_000, maxCachedMessages: 10 },
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const preparedImage: MediaMetadata = {
  kind: "image", mimeType: "image/png", data: PNG, fileName: "smile.png",
  size: PNG.byteLength, sha256: "abc",
};
const preparedAudio: MediaMetadata = {
  kind: "audio", mimeType: "audio/mpeg", data: Buffer.from([0x49, 0x44, 0x33, 1]),
  size: 4, sha256: "def",
};

class FakeGateway implements WeChatGateway {
  stored = false;
  running = false;
  callbacks?: LoginCallbacks;
  events?: WeChatGatewayEvents;
  loginPromise?: Promise<WeChatCredentials>;
  loginResolve?: (credentials: WeChatCredentials) => void;
  sent: Array<{ kind: string; id: string; content?: string }> = [];
  incomingMedia: MediaData | null = null;
  rememberedNativeUserId?: string;
  async hasStoredCredentials() { return this.stored; }
  async login(callbacks: LoginCallbacks): Promise<WeChatCredentials> {
    this.callbacks = callbacks;
    this.loginPromise = new Promise((resolve) => { this.loginResolve = resolve; });
    return this.loginPromise;
  }
  async start(events: WeChatGatewayEvents) { this.events = events; this.running = true; }
  async stop() { this.running = false; }
  isRunning() { return this.running; }
  async sendText(id: string, content: string) { this.sent.push({ kind: "send", id, content }); }
  async replyText(message: WeChatIncomingMessage, content: string) { this.sent.push({ kind: "reply", id: message.userId, content }); }
  async downloadMedia() { return this.incomingMedia; }
  async sendMedia(id: string, media: MediaMetadata) { this.sent.push({ kind: `send-${media.kind}`, id }); }
  async replyMedia(message: WeChatIncomingMessage, media: MediaMetadata) { this.sent.push({ kind: `reply-${media.kind}`, id: message.userId }); }
  async sendTyping(id: string) { this.sent.push({ kind: "typing", id }); }
  async rememberUser(nativeUserId: string) { this.rememberedNativeUserId = nativeUserId; }
}

test("autoStart without credentials reports login.required once and stays quiet", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  const observations: any[] = [];
  adapter.subscribe((observation) => { observations.push(observation); });
  await adapter.start();
  assert.equal(adapter.autoStart, true);
  assert.equal(adapter.health().status, "degraded");
  assert.equal(observations.length, 1);
  assert.equal(observations[0].content.eventType, "login.required");
  assert.equal(gateway.callbacks, undefined);
});

test("explicit login returns QR URL, then authorization completes without another interaction", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  const observations: any[] = [];
  adapter.subscribe((observation) => { observations.push(observation); });
  const resultPromise = adapter.interact({ call_id: "login-1", adapter_id: adapter.id, action: "login", args: {} });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gateway.callbacks?.onQrUrl("https://liteapp.weixin.qq.com/q/test");
  const result = JSON.parse((await resultPromise).content);
  assert.equal(result.status, "pending");
  assert.equal(result.qrUrl, "https://liteapp.weixin.qq.com/q/test");
  gateway.callbacks?.onScanned();
  gateway.loginResolve?.({ accountId: "bot-1", userId: "bot@im.wechat" });
  await gateway.loginPromise;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(adapter.health().status, "online");
  assert.equal(gateway.running, true);
  assert.ok(observations.some((item) => item.content.eventType === "login.succeeded"));
});

test("every incoming channel message uses public user 0 with high trust", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  const observations: any[] = [];
  adapter.subscribe((observation) => { observations.push(observation); });
  await logIn(adapter, gateway, "login-2");
  await adapter.handleMessage({ userId: "owner@im.wechat", text: "你好", type: "text", timestamp: new Date(), raw: { message_id: "msg-1" } });
  const reply = await adapter.interact({ call_id: "reply-1", adapter_id: adapter.id, action: "reply_message", args: { messageId: "msg-1", content: "收到" } });
  assert.equal(JSON.parse(reply.content).status, "success");
  assert.equal(observations.at(-1).actor, "user");
  assert.equal(observations.at(-1).trust, "high");
  assert.equal(observations.at(-1).attention, "high");
  assert.equal(observations.at(-1).source, "wechat:0");
  assert.equal(observations.at(-1).content.userId, "0");
  assert.equal(gateway.rememberedNativeUserId, "owner@im.wechat");
  assert.deepEqual(gateway.sent, [{ kind: "reply", id: "owner@im.wechat", content: "收到" }]);
});

test("incoming image is downloaded into the standard internal media envelope", async () => {
  const gateway = new FakeGateway();
  gateway.incomingMedia = { kind: "image", mimeType: "image/png", data: PNG, fileName: "incoming.png" };
  const adapter = new WeChatAdapter({ config: { ...config, receive: { ...config.receive, messageTypes: ["image"] } }, gateway });
  const observations: any[] = [];
  adapter.subscribe((observation) => { observations.push(observation); });
  await adapter.handleMessage({ userId: "owner@im.wechat", text: "", type: "image", timestamp: new Date(), raw: { message_id: "image-1" } });
  const content = observations[0].content;
  assert.equal(content.messageType, "image");
  assert.equal(content.userId, "0");
  assert.equal(content.media.kind, "image");
  assert.equal(content.media.size, PNG.byteLength);
  assert.match(content.media.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Buffer.from(content.media.data), PNG);
  assert.equal(content.text, "[image]");
});

test("prepared image media is sent without direct MediaService access", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  await logIn(adapter, gateway, "login-media");
  const result = await adapter.interact({
    call_id: "send-media", adapter_id: adapter.id, action: "send_media",
    args: { userId: "0", media: preparedImage },
  });
  const body = JSON.parse(result.content);
  assert.equal(body.status, "success");
  assert.equal(body.delivery, "native_image");
  assert.equal(body.media.data, undefined);
  assert.deepEqual(gateway.sent, [{ kind: "send-image", id: "0" }]);
});

test("incoming voice is downloaded as typed internal audio", async () => {
  const gateway = new FakeGateway();
  gateway.incomingMedia = { kind: "audio", mimeType: "audio/wav", data: Buffer.from("RIFFxxxxWAVE") };
  const adapter = new WeChatAdapter({ config: { ...config, receive: { ...config.receive, messageTypes: ["voice"] } }, gateway });
  const observations: any[] = [];
  adapter.subscribe((observation) => { observations.push(observation); });
  await adapter.handleMessage({ userId: "another-native-id", text: "", type: "voice", timestamp: new Date(), raw: { message_id: "voice-1" } });
  assert.equal(observations[0].content.userId, "0");
  assert.equal(observations[0].content.media.kind, "audio");
  assert.equal(observations[0].content.text, "[audio]");
  assert.equal(observations[0].trust, "high");
});

test("prepared audio is delivered through the voice-message path", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  await logIn(adapter, gateway, "login-audio");
  const result = await adapter.interact({
    call_id: "send-audio", adapter_id: adapter.id, action: "send_media",
    args: { userId: "0", media: preparedAudio },
  });
  const body = JSON.parse(result.content);
  assert.equal(body.status, "success");
  assert.equal(body.delivery, "voice_bubble");
  assert.deepEqual(gateway.sent, [{ kind: "send-audio", id: "0" }]);
});

test("WeChat voice bridge uploads as VOICE and sends a native voice item", async () => {
  const calls: any[] = [];
  const bot = {
    async upload(options: any) {
      calls.push(["upload", options]);
      return { media: { encrypt_query_param: "query", aes_key: "key" } };
    },
    createMessage(userId: string) {
      return {
        text(content: string) { calls.push(["text", content]); return this; },
        build() {
          return { from_user_id: "", to_user_id: userId, client_id: "test", message_type: 2, message_state: 2, context_token: "ctx", item_list: [{ type: 1, text_item: { text: "seed" } }] };
        },
      };
    },
    async sendRaw(payload: any) { calls.push(["sendRaw", payload]); },
  };
  const audio = { ...preparedAudio, durationMs: 1_234 };
  await sendWeChatVoice(bot as any, "native-user", audio);
  assert.equal(calls[0][1].mediaType, 4);
  assert.equal(calls[0][1].userId, "native-user");
  const payload = calls.at(-1)[1];
  assert.equal(payload.item_list.length, 1);
  assert.deepEqual(payload.item_list[0], createVoiceItem(audio, { encrypt_query_param: "query", aes_key: "key" }));
  assert.equal(payload.item_list[0].type, 3);
  assert.ok(payload.item_list[0].voice_item);
  assert.equal(payload.item_list[0].voice_item.encode_type, 7);
  assert.equal(payload.item_list[0].voice_item.playtime, 1_234);
});

test("raw MediaRef input is rejected when Pipeline preparation is bypassed", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  await logIn(adapter, gateway, "login-ref");
  const result = await adapter.interact({
    call_id: "raw-ref", adapter_id: adapter.id, action: "send_media",
    args: { userId: "0", media: { type: "media_ref", source: "artifact", kind: "image", id: "20260821-ab-", description: "x" } },
  });
  assert.equal(JSON.parse(result.content).status, "error");
});

test("non-zero public user IDs are rejected", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  await logIn(adapter, gateway, "login-invalid");
  const result = await adapter.interact({ call_id: "bad-user", adapter_id: adapter.id, action: "send_message", args: { userId: "native", content: "no" } });
  assert.equal(JSON.parse(result.content).status, "error");
});

async function logIn(adapter: WeChatAdapter, gateway: FakeGateway, callId: string) {
  const login = adapter.interact({ call_id: callId, adapter_id: adapter.id, action: "login", args: {} });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gateway.callbacks?.onQrUrl("https://liteapp.weixin.qq.com/q/test");
  await login;
  gateway.loginResolve?.({ accountId: "bot-1", userId: "bot@im.wechat" });
  await gateway.loginPromise;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
