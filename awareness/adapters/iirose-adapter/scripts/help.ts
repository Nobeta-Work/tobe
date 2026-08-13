export interface CommandContext {
  status(): string;
  pluginCommands(): readonly string[];
}

export interface CommandDefinition {
  name: string;
  usage: string;
  description: string;
  execute(args: readonly string[], context: CommandContext): string | Promise<string>;
}

/** Adapter 当前公开的全部本地命令；help 文本由这里生成，避免文档漂移。 */
export const COMMANDS: readonly CommandDefinition[] = [
  {
    name: "help",
    usage: "/help",
    description: "显示所有本地白名单命令",
    execute: (_args, context) => renderHelp(context.pluginCommands()),
  },
  {
    name: "ping",
    usage: "/ping",
    description: "检查 Adapter 是否仍能响应",
    execute: () => "pong",
  },
  {
    name: "status",
    usage: "/status",
    description: "显示当前连接状态",
    execute: (_args, context) => context.status(),
  },
];

export function renderHelp(pluginCommands: readonly string[] = []): string {
  return [
    "ToBe · IIROSE 本地命令",
    ...COMMANDS.map((command) => `${command.usage} — ${command.description}`),
    ...pluginCommands,
  ].join("\n");
}

export async function runCommand(
  content: string,
  prefix: string,
  whitelist: readonly string[],
  context: CommandContext,
): Promise<{ handled: boolean; response?: string; command?: string }> {
  if (!content.startsWith(prefix)) return { handled: false };
  const [name = "", ...args] = content.slice(prefix.length).trim().split(/\s+/);
  const command = COMMANDS.find((item) => item.name === name.toLowerCase());
  if (!command || !whitelist.includes(command.name)) return { handled: false };
  return { handled: true, command: command.name, response: await command.execute(args, context) };
}
