import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export async function findNamedSession(directory: string, name: string): Promise<string | undefined> {
  await mkdir(directory, { recursive: true });
  const candidates: Array<{ path: string; modified: number }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const path = join(directory, entry.name);
    if (await effectiveSessionName(path) !== name) continue;
    candidates.push({ path, modified: (await stat(path)).mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  return candidates[0]?.path;
}

async function effectiveSessionName(path: string): Promise<string | undefined> {
  let current: string | undefined;
  const content = await readFile(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; name?: unknown };
      if (entry.type === "session_info") current = typeof entry.name === "string" ? entry.name : undefined;
    } catch {
      // A partially written final line is ignored. Pi will recover the session itself.
    }
  }
  return current;
}

