import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface MessageLogEntry {
  receivedAt: number;
  timestamp: number;
  source: string;
  eventType: "message.public" | "message.private";
  userId: string;
  username: string;
  text: string;
  messageId?: string;
  roomId?: string;
  isAdmin: boolean;
  mentioned: boolean;
  reply: boolean;
}

/** 每月一个无扩展名 JSONL 文件，例如 logs/202608。 */
export class MonthlyMessageLog {
  readonly #directory: string;
  #writeLock: Promise<void> = Promise.resolve();

  constructor(directory: string) { this.#directory = directory; }

  append(entry: MessageLogEntry): Promise<void> {
    this.#writeLock = this.#writeLock.then(async () => {
      await mkdir(this.#directory, { recursive: true });
      await appendFile(this.#path(entry.receivedAt), `${JSON.stringify(entry)}\n`, "utf8");
    });
    return this.#writeLock;
  }

  async recent(limit: number, source?: string, now = Date.now()): Promise<MessageLogEntry[]> {
    const entries = await this.#readCurrent(now);
    const selected = source ? entries.filter((entry) => entry.source === source) : entries;
    return selected.slice(-Math.max(0, limit));
  }

  /** start/end 是从最新一条起算的 1-based 闭区间；(11,20) 返回再往前的十条。 */
  async range(start: number, end: number, now = Date.now()): Promise<MessageLogEntry[]> {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start >= 100) {
      throw new Error("history requires 1 <= start <= end and at most 100 messages");
    }
    const entries = await this.#readCurrent(now);
    const newestFirst = [...entries].reverse().slice(start - 1, end);
    return newestFirst.reverse();
  }

  fileName(now = Date.now()): string { return monthName(now); }

  async #readCurrent(now: number): Promise<MessageLogEntry[]> {
    await this.#writeLock;
    try {
      const body = await readFile(this.#path(now), "utf8");
      return body.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as MessageLogEntry]; }
        catch { return []; }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  #path(now: number): string { return join(this.#directory, monthName(now)); }
}

function monthName(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
}
