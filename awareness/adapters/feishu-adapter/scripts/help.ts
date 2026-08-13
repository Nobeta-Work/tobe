export interface FeishuCommandResult { handled: boolean; response?: string }

export function runCommand(text: string, nickname: string, prefix: string, whiteList: readonly string[], status: () => string): FeishuCommandResult {
  let candidate = text.trim();
  if (prefix === "{name}") {
    if (candidate.startsWith(nickname)) candidate = candidate.slice(nickname.length).trim();
    else if (candidate.startsWith("/")) candidate = candidate.slice(1).trim();
    else return { handled: false };
  } else {
    if (!candidate.startsWith(prefix)) return { handled: false };
    candidate = candidate.slice(prefix.length).trim();
  }
  const command = candidate.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (!whiteList.includes(command)) return { handled: false };
  if (command === "help") return { handled: true, response: `可用命令：${whiteList.join("、")}` };
  if (command === "status") return { handled: true, response: status() };
  if (command === "ping") return { handled: true, response: "pong" };
  return { handled: true };
}
