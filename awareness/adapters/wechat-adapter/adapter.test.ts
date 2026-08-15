import assert from "node:assert/strict";
import test from "node:test";
import type { MediaData, MediaGenerateRequest, MediaInput, MediaRecognition, MediaService, ResolvedMedia } from "../../../media/type.ts";
import { WeChatAdapter } from "./ADAPTER.ts";
import type { WeChatConfig } from "./config.ts";
import type { WeChatIncomingMessage } from "./protocol.ts";
import type { LoginCallbacks, WeChatCredentials, WeChatGateway, WeChatGatewayEvents } from "./scripts/client.ts";

const config: WeChatConfig = {
  enabled: true, autoStart: true, storageDir: "unused", logLevel: "silent", botAgent: "test",
  identity: { ownerIds: ["owner@im.wechat"] },
  receive: { messageTypes: ["text"], allowUsers: [], denyUsers: [] },
  events: { dedupeTtlMs: 60_000, messageCacheTtlMs: 60_000, maxCachedMessages: 10 },
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const resolvedImage: ResolvedMedia = {
  artifact: {
    version: 1, id: "library_123", kind: "image", mimeType: "image/png", fileName: "smile.png",
    size: PNG.byteLength, sha256: "abc",
    origin: { type: "library", category: "stickers", tag: "开心" },
  },
  data: PNG,
};

class FakeMediaService implements MediaService {
  resolvedInputs: MediaInput[] = [];
  async status() { return { recognition: { image: true, audio: true }, generation: { image: true, audio: true }, libraryKinds: ["image" as const] }; }
  async list() { return { kind: "image" as const, categories: { stickers: ["开心"] } }; }
  async recognize(input: MediaData): Promise<MediaRecognition> {
    return {
      media: { version: 1, kind: input.kind, mimeType: input.mimeType, size: input.data.byteLength, sha256: "incoming", origin: { type: "imported" } },
      text: "一张开心的表情图片", provider: "fake-recognizer",
    };
  }
  async generate(_request: MediaGenerateRequest) { return resolvedImage.artifact; }
  async resolve(input: MediaInput) { this.resolvedInputs.push(input); return resolvedImage; }
  async inspect() { return undefined; }
}

class FakeGateway implements WeChatGateway {
  stored = false;
  running = false;
  callbacks?: LoginCallbacks;
  events?: WeChatGatewayEvents;
  loginPromise?: Promise<WeChatCredentials>;
  loginResolve?: (credentials: WeChatCredentials) => void;
  sent: Array<{ kind: string; id: string; content?: string }> = [];
  incomingMedia: MediaData | null = null;
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
  async sendMedia(id: string, media: ResolvedMedia) { this.sent.push({ kind: `send-${media.artifact.kind}`, id }); }
  async replyMedia(message: WeChatIncomingMessage, media: ResolvedMedia) { this.sent.push({ kind: `reply-${media.artifact.kind}`, id: message.userId }); }
  async sendTyping(id: string) { this.sent.push({ kind: "typing", id }); }
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

test("received owner text can be replied to through the cached message", async () => {
  const gateway = new FakeGateway();
  const adapter = new WeChatAdapter({ config, gateway });
  const observations: any[] = [];
  adapter.subscribe((observation) => { observations.push(observation); });
  const login = adapter.interact({ call_id: "login-2", adapter_id: adapter.id, action: "login", args: {} });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gateway.callbacks?.onQrUrl("https://liteapp.weixin.qq.com/q/test");
  await login;
  gateway.loginResolve?.({ accountId: "bot-1", userId: "bot@im.wechat" });
  await gateway.loginPromise;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await adapter.handleMessage({ userId: "owner@im.wechat", text: "你好", type: "text", timestamp: new Date(), raw: { message_id: "msg-1" } });
  const reply = await adapter.interact({ call_id: "reply-1", adapter_id: adapter.id, action: "reply_message", args: { messageId: "msg-1", content: "收到" } });
  assert.equal(JSON.parse(reply.content).status, "success");
  assert.equal(observations.at(-1).actor, "user");
  assert.deepEqual(gateway.sent, [{ kind: "reply", id: "owner@im.wechat", content: "收到" }]);
});

test("incoming image remains typed media while Media supplies its text explanation", async () => {
  const gateway = new FakeGateway();
  gateway.incomingMedia = { kind: "image", mimeType: "image/png", data: PNG, fileName: "incoming.png" };
  const mediaService = new FakeMediaService();
  const adapter = new WeChatAdapter({ config: { ...config, receive: { ...config.receive, messageTypes: ["image"] } }, gateway, mediaService });
  const observations: any[] = [];
  adapter.subscribe((observation) => { observations.push(observation); });
  await adapter.handleMessage({ userId: "owner@im.wechat", text: "[image]", type: "image", timestamp: new Date(), raw: { message_id: "image-1" } });
  const content = observations[0].content;
  assert.equal(content.messageType, "image");
  assert.equal(content.media.kind, "image");
  assert.equal(content.mediaRecognition.status, "success");
  assert.equal(content.text, "一张开心的表情图片");
});

test("send_media lets the Adapter resolve a listed category and convert it for WeChat", async () => {
  const gateway = new FakeGateway();
  const mediaService = new FakeMediaService();
  const adapter = new WeChatAdapter({ config, gateway, mediaService });
  const login = adapter.interact({ call_id: "login-media", adapter_id: adapter.id, action: "login", args: {} });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gateway.callbacks?.onQrUrl("https://liteapp.weixin.qq.com/q/test");
  await login;
  gateway.loginResolve?.({ accountId: "bot-1", userId: "bot@im.wechat" });
  await gateway.loginPromise;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const result = await adapter.interact({
    call_id: "send-media", adapter_id: adapter.id, action: "send_media",
    args: { userId: "owner@im.wechat", media: { source: "library", kind: "image", category: "stickers", tag: "开心", selection: "random" } },
  });
  assert.equal(JSON.parse(result.content).status, "success");
  assert.deepEqual(mediaService.resolvedInputs, [{ source: "library", kind: "image", category: "stickers", tag: "开心", selection: "random" }]);
  assert.deepEqual(gateway.sent, [{ kind: "send-image", id: "owner@im.wechat" }]);
});
