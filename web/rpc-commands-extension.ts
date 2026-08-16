import { join } from "node:path";
import {
  getAgentDir,
  ModelRuntime,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const API_KEY_OPTION = "API Key（手动填写 Provider ID）";
let authRuntimePromise: Promise<ModelRuntime> | undefined;

async function getAuthRuntime(ctx: ExtensionCommandContext): Promise<ModelRuntime> {
  const runtime = await (authRuntimePromise ??= ModelRuntime.create({
    authPath: join(getAgentDir(), "auth.json"),
    allowModelNetwork: false,
  }));

  for (const providerId of ctx.modelRegistry.getRegisteredProviderIds()) {
    const nativeProvider = ctx.modelRegistry.getRegisteredNativeProvider(providerId);
    if (nativeProvider) {
      runtime.registerNativeProvider(nativeProvider);
      continue;
    }
    const config = ctx.modelRegistry.getRegisteredProviderConfig(providerId);
    if (config) runtime.registerProvider(providerId, config);
  }

  return runtime;
}

async function login(
  runtime: ModelRuntime,
  providerId: string,
  authType: "api_key" | "oauth",
  ctx: ExtensionCommandContext,
): Promise<void> {
  const statusKey = "web-login";
  const widgetKey = "web-login-info";
  try {
    await runtime.login(providerId, authType, {
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const labels = prompt.options.map((option) => option.label);
          const selected = await ctx.ui.select(prompt.message, labels);
          return prompt.options.find((option) => option.label === selected)?.id ?? "";
        }
        return (await ctx.ui.input(prompt.message, prompt.placeholder ?? "")) ?? "";
      },
      notify: (event) => {
        if (event.type === "progress") {
          ctx.ui.setStatus(statusKey, event.message);
          return;
        }
        if (event.type === "auth_url") {
          ctx.ui.setWidget(widgetKey, [event.instructions ?? "请在浏览器完成认证：", event.url], {
            placement: "aboveEditor",
          });
          return;
        }
        if (event.type === "device_code") {
          ctx.ui.setWidget(widgetKey, ["请在浏览器完成认证：", event.verificationUri, `验证码：${event.userCode}`], {
            placement: "aboveEditor",
          });
          return;
        }
        ctx.ui.setWidget(
          widgetKey,
          [event.message, ...(event.links ?? []).map((link) => `${link.label ?? "链接"}：${link.url}`)],
          { placement: "aboveEditor" },
        );
      },
    });
  } finally {
    ctx.ui.setStatus(statusKey, undefined);
    ctx.ui.setWidget(widgetKey, undefined);
  }
}

export default function rpcCommandsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("login", {
    description: "在 Web 中配置 Provider 认证",
    handler: async (args, ctx) => {
      const runtime = await getAuthRuntime(ctx);
      const oauthProviders = runtime.getProviders().filter((provider) => provider.auth.oauth);
      let providerId = args.trim().split(/\s+/, 1)[0] || "";
      let oauthProvider = oauthProviders.find((provider) => provider.id === providerId);

      if (!providerId) {
        const labels = [...oauthProviders.map((provider) => `${provider.name} (${provider.id})`), API_KEY_OPTION];
        const selected = await ctx.ui.select("选择认证方式", labels);
        if (!selected) return;
        oauthProvider = oauthProviders.find((provider) => selected.endsWith(`(${provider.id})`));
        if (oauthProvider) providerId = oauthProvider.id;
        else providerId = (await ctx.ui.input("Provider ID", "例如 anthropic、openai、google"))?.trim() || "";
      }
      if (!providerId) return;
      oauthProvider ??= oauthProviders.find((provider) => provider.id === providerId);

      if (oauthProvider) {
        await login(runtime, oauthProvider.id, "oauth", ctx);
      } else {
        const provider = runtime.getProvider(providerId);
        if (!provider?.auth.apiKey?.login) {
          ctx.ui.notify(`Provider ${providerId} 不存在，或不支持通过 Pi 保存 API Key`, "warning");
          return;
        }
        await login(runtime, providerId, "api_key", ctx);
      }

      ctx.ui.notify(`已保存 ${providerId} 的认证信息，正在恢复 Agent`, "info");
      ctx.shutdown();
    },
  });

  pi.registerCommand("logout", {
    description: "移除 Web 中选择的 Provider 认证",
    handler: async (args, ctx) => {
      const runtime = await getAuthRuntime(ctx);
      const stored = (await runtime.listCredentials()).map((credential) => credential.providerId).sort();
      if (!stored.length) {
        ctx.ui.notify("没有由 /login 保存的认证信息", "info");
        return;
      }
      const requested = args.trim().split(/\s+/, 1)[0] || "";
      const providerId = requested || await ctx.ui.select("选择要退出的 Provider", stored);
      if (!providerId) return;
      if (!stored.includes(providerId)) {
        ctx.ui.notify(`没有找到 ${providerId} 的已保存认证`, "warning");
        return;
      }
      const confirmed = await ctx.ui.confirm("移除认证信息", `确认从 Pi auth.json 移除 ${providerId}？`);
      if (!confirmed) return;
      await runtime.logout(providerId);
      ctx.ui.notify(`已移除 ${providerId} 的认证信息，正在恢复 Agent`, "info");
      ctx.shutdown();
    },
  });
}
