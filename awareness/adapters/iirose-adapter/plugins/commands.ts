import type { PluginCommandsConfig } from "../config.ts";

export interface PluginCommandMatch {
  command: string;
  args: string;
}

/** 匹配插件自己的命令域；匹配成功即应由 Adapter 本地消费。 */
export function matchPluginCommand(
  content: string,
  commands: PluginCommandsConfig,
  identity: { username: string; nickname: string },
): PluginCommandMatch | null {
  const body = stripPrefix(content, commands.prefix, identity);
  if (body === null) return null;
  const whiteList = typeof commands.whiteList === "string" ? [commands.whiteList] : commands.whiteList;
  const command = [...whiteList].sort((a, b) => b.length - a.length).find((item) => body.startsWith(item));
  if (!command) return null;
  return { command, args: body.slice(command.length).trim() };
}

function stripPrefix(content: string, prefix: string, identity: { username: string; nickname: string }): string | null {
  if (prefix !== "{name}") return content.startsWith(prefix) ? content.slice(prefix.length).trimStart() : null;
  const input = content.trimStart();
  const mention = `[*${identity.username}*]`;
  if (identity.username && input.startsWith(mention)) return input.slice(mention.length).trimStart();
  if (identity.nickname && input.startsWith(identity.nickname)) return input.slice(identity.nickname.length).trimStart();
  return null;
}
