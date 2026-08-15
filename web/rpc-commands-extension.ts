import { join } from "node:path";
import { AuthStorage, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const API_KEY_OPTION = "API Key（手动填写 Provider ID）";

export default function rpcCommandsExtension(pi: ExtensionAPI): void {
  const auth = AuthStorage.create(join(getAgentDir(), "auth.json"));

  pi.registerCommand("login", {
    description: "在 Web 中配置 Provider 认证",
    handler: async (args, ctx) => {
      auth.reload();
      const oauthProviders = auth.getOAuthProviders();
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
        const statusKey = "web-login";
        const widgetKey = "web-login-url";
        try {
          await auth.login(oauthProvider.id, {
            onAuth: (info) => ctx.ui.setWidget(widgetKey, [info.instructions || "请在浏览器完成认证：", info.url], { placement: "aboveEditor" }),
            onPrompt: async (prompt) => (await ctx.ui.input(prompt.message, prompt.placeholder || "")) || "",
            onProgress: (message) => ctx.ui.setStatus(statusKey, message),
            onManualCodeInput: async () => (await ctx.ui.input("粘贴认证回调 URL 或授权码", "完成浏览器认证后粘贴")) || "",
            onSelect: async (prompt) => {
              const label = await ctx.ui.select(prompt.message, prompt.options.map((option) => option.label));
              return prompt.options.find((option) => option.label === label)?.id;
            },
          });
        } finally {
          ctx.ui.setStatus(statusKey, undefined);
          ctx.ui.setWidget(widgetKey, undefined);
        }
      } else {
        const key = await ctx.ui.input(`API Key · ${providerId}`, "密钥只会写入 Pi auth.json");
        if (!key?.trim()) return;
        auth.set(providerId, { type: "api_key", key: key.trim() });
      }

      ctx.ui.notify(`已保存 ${providerId} 的认证信息，正在恢复 Agent`, "info");
      ctx.shutdown();
    },
  });

  pi.registerCommand("logout", {
    description: "移除 Web 中选择的 Provider 认证",
    handler: async (args, ctx) => {
      auth.reload();
      const stored = auth.list().sort();
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
      auth.logout(providerId);
      ctx.ui.notify(`已移除 ${providerId} 的认证信息，正在恢复 Agent`, "info");
      ctx.shutdown();
    },
  });
}
