import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WEB_CONFIG_PATH } from "./lib/paths.ts";
import type { CustomProviderConfig } from "./lib/config.ts";

const PROVIDER_ID = "tobe-custom";

export default async function customProviderExtension(pi: ExtensionAPI): Promise<void> {
  const stored = JSON.parse(await readFile(WEB_CONFIG_PATH, "utf8")) as { customProvider?: Partial<CustomProviderConfig> };
  const config = stored.customProvider;
  if (!config?.enabled || !config.baseUrl || !config.apiKey || !config.model) return;
  pi.registerProvider(PROVIDER_ID, {
    name: "ToBe Custom API",
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    api: "openai-completions",
    authHeader: true,
    models: [{
      id: config.model,
      name: config.model,
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    }],
  });
}
