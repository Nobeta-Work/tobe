import assert from "node:assert/strict";
import test from "node:test";
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

class FakeGateway implements WeChatGateway {
  stored = false;
  running = false;
  callbacks?: LoginCallbacks;
  events?: WeChatGatewayEvents;
  loginPromise?: Promise<WeChatCredentials>;
  loginResolve?: (credentials: WeChatCredentials) => void;
  sent: Array<{ kind: string; id: string; content?: string }> = [];
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
