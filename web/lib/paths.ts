import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = resolve(WEB_DIR, "..");
export const PUBLIC_DIR = join(WEB_DIR, "public");
export const DATA_DIR = join(WEB_DIR, "data");
export const SESSION_DIR = join(DATA_DIR, "sessions");
export const CUSTOM_PROVIDER_EXTENSION_PATH = join(WEB_DIR, "provider-extension.ts");
export const RPC_COMMANDS_EXTENSION_PATH = join(WEB_DIR, "rpc-commands-extension.ts");
export const WEB_CONFIG_PATH = join(WEB_DIR, "config.json");
export const WEB_CONFIG_DEFAULT_PATH = join(WEB_DIR, "config.default.json");
export const ADAPTERS_DIR = join(REPO_DIR, "awareness", "adapters");
export const MEDIA_DIR = join(REPO_DIR, "media");
export const MEMORY_DIR = join(REPO_DIR, "memory");
