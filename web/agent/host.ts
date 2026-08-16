import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CUSTOM_PROVIDER_EXTENSION_PATH, REPO_DIR, RPC_COMMANDS_EXTENSION_PATH, SESSION_DIR } from "../lib/paths.ts";
import type { CustomProviderConfig } from "../lib/config.ts";
import { findNamedSession } from "./sessions.ts";

const SESSION_NAME = "tobe";
const RPC_TIMEOUT_MS = 30_000;

interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentSnapshot {
  processState: "stopped" | "starting" | "running" | "recovering";
  desiredRunning: boolean;
  state: Record<string, unknown> | null;
  error: string | null;
  stats: Record<string, unknown> | null;
  commands: unknown[];
}

export class AgentHost extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private processState: AgentSnapshot["processState"] = "stopped";
  private desiredRunning = false;
  private lastState: Record<string, unknown> | null = null;
  private lastError: string | null = null;
  private lastStats: Record<string, unknown> | null = null;
  private lastCommands: unknown[] = [];
  private sequence = 0;
  private restartAttempt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private stdoutBuffer = "";
  private readonly pending = new Map<string, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly getCustomProvider: () => CustomProviderConfig) {
    super();
  }

  snapshot(): AgentSnapshot {
    return {
      processState: this.processState,
      desiredRunning: this.desiredRunning,
      state: this.lastState,
      error: this.lastError,
      stats: this.lastStats,
      commands: this.lastCommands,
    };
  }

  async start(): Promise<AgentSnapshot> {
    this.desiredRunning = true;
    if (this.child) return this.snapshot();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.spawnAgent(false);
    return this.snapshot();
  }

  async stop(): Promise<AgentSnapshot> {
    this.desiredRunning = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    if (!child) {
      this.setProcessState("stopped");
      return this.snapshot();
    }
    try { await this.command({ type: "abort" }, 3_000); } catch {}
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 2_000);
    timer.unref();
    return this.snapshot();
  }

  async prompt(message: string): Promise<void> {
    const input = message.trim();
    if (!input) throw new Error("消息不能为空");
    if (!this.child) throw new Error("Agent 尚未启动");
    await this.command({ type: "prompt", message: input, streamingBehavior: "followUp" });
    await this.refreshState();
    if (input.startsWith("/")) await this.refreshMetrics();
  }

  async abort(): Promise<void> {
    if (!this.child) return;
    await this.command({ type: "abort" });
  }

  async messages(): Promise<unknown[]> {
    if (!this.child) return [];
    const response = await this.command({ type: "get_messages" });
    const data = response.data as { messages?: unknown[] } | undefined;
    return data?.messages ?? [];
  }

  respondToUi(response: Record<string, unknown>): void {
    const child = this.child;
    if (!child || !child.stdin.writable) throw new Error("Agent 尚未启动");
    if (typeof response.id !== "string" || !response.id) throw new Error("缺少交互请求 ID");
    child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", ...response })}\n`);
  }

  async refreshMetrics(): Promise<AgentSnapshot> {
    if (!this.child) return this.snapshot();
    const stats = await this.command({ type: "get_session_stats" });
    this.lastStats = (stats.data ?? null) as Record<string, unknown> | null;
    const commands = await this.command({ type: "get_commands" });
    const data = commands.data as { commands?: unknown[] } | unknown[] | undefined;
    this.lastCommands = Array.isArray(data) ? data : data?.commands ?? [];
    this.broadcast("agent.state", this.snapshot());
    return this.snapshot();
  }

  async refreshState(): Promise<AgentSnapshot> {
    if (!this.child) return this.snapshot();
    const response = await this.command({ type: "get_state" });
    this.lastState = (response.data ?? null) as Record<string, unknown> | null;
    this.broadcast("agent.state", this.snapshot());
    return this.snapshot();
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  private async spawnAgent(recovering: boolean): Promise<void> {
    await mkdir(SESSION_DIR, { recursive: true });
    const existingSession = await findNamedSession(SESSION_DIR, SESSION_NAME);
    const cli = join(REPO_DIR, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    const args = [cli, "--mode", "rpc", "--session-dir", SESSION_DIR, "--no-extensions"];
    for (const extension of await declaredExtensions()) args.push("--extension", extension);
    args.push("--extension", RPC_COMMANDS_EXTENSION_PATH);
    const customProvider = this.getCustomProvider();
    if (customProvider.enabled) {
      if (!customProvider.baseUrl || !customProvider.apiKey || !customProvider.model) {
        throw new Error("自定义 Provider 配置不完整，请在设置中填写 Base URL、Key 和 Model");
      }
      args.push("--extension", CUSTOM_PROVIDER_EXTENSION_PATH, "--provider", "tobe-custom", "--model", customProvider.model);
    }
    if (existingSession) args.push("--session", existingSession);
    this.setProcessState(recovering ? "recovering" : "starting");
    this.lastError = null;
    const child = spawn(process.execPath, args, { cwd: REPO_DIR, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.stdoutBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => this.broadcast("agent.stderr", { message: chunk.trim() }));
    child.on("error", (error) => this.handleExit(error));
    child.on("exit", (code, signal) => this.handleExit(new Error(`Pi exited (${code ?? signal ?? "unknown"})`)));

    try {
      await this.refreshState();
      await this.command({ type: "set_session_name", name: SESSION_NAME });
      await this.refreshState();
      await this.refreshMetrics();
      this.restartAttempt = 0;
      this.setProcessState("running");
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  private command(command: Record<string, unknown>, timeout = RPC_TIMEOUT_MS): Promise<RpcResponse> {
    const child = this.child;
    if (!child || !child.stdin.writable) return Promise.reject(new Error("Pi RPC 不可用"));
    const id = `web-${++this.sequence}`;
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC 超时: ${String(command.type)}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    }).then((response) => {
      if (!response.success) throw new Error(response.error || `Pi RPC command failed: ${response.command}`);
      return response;
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line) this.consumeLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeLine(line: string): void {
    let value: Record<string, unknown>;
    try { value = JSON.parse(line) as Record<string, unknown>; }
    catch {
      this.broadcast("agent.protocol_error", { message: "Pi 输出了无效 JSONL" });
      return;
    }
    if (value.type === "response" && typeof value.id === "string") {
      const pending = this.pending.get(value.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(value.id);
        pending.resolve(value as unknown as RpcResponse);
        return;
      }
    }
    this.broadcast("agent.event", value);
    if (value.type === "agent_start" || value.type === "agent_end" || value.type === "message_end") {
      void this.refreshState().then(() => this.refreshMetrics()).catch(() => undefined);
    }
  }

  private handleExit(error: Error): void {
    if (!this.child) return;
    this.child = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.lastError = error.message;
    if (!this.desiredRunning) {
      this.lastError = null;
      this.setProcessState("stopped");
      return;
    }
    this.setProcessState("recovering");
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.restartAttempt++, 5));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.spawnAgent(true).catch((spawnError) => this.handleSpawnFailure(spawnError));
    }, delay);
  }

  private handleSpawnFailure(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    if (!this.desiredRunning) return;
    this.setProcessState("recovering");
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.restartAttempt++, 5));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.spawnAgent(true).catch((spawnError) => this.handleSpawnFailure(spawnError));
    }, delay);
  }

  private setProcessState(state: AgentSnapshot["processState"]): void {
    this.processState = state;
    this.broadcast("agent.state", this.snapshot());
  }

  private broadcast(type: string, data: unknown): void {
    this.emit("event", { type, data, at: new Date().toISOString() });
  }
}

async function declaredExtensions(): Promise<string[]> {
  const packageJson = JSON.parse(await readFile(join(REPO_DIR, "package.json"), "utf8")) as { pi?: { extensions?: unknown } };
  const extensions = packageJson.pi?.extensions;
  if (!Array.isArray(extensions)) return [];
  return extensions.filter((value): value is string => typeof value === "string").map((value) => resolve(REPO_DIR, value));
}
