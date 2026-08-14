import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { MEMORY_DIR } from "../lib/paths.ts";
import { writeTextAtomic } from "../lib/files.ts";
import { HttpError } from "./awareness.ts";

interface MemoryEntry { id: string; label: string; editable: boolean; exists: boolean; kind: "cognition" | "dream" | "skill"; }

const cognition = [
  { id: "base", label: "BASE", path: join(MEMORY_DIR, "BASE.md"), editable: false },
  { id: "identity", label: "IDENTITY", path: join(MEMORY_DIR, "IDENTITY.md"), editable: true },
  { id: "self", label: "SELF", path: join(MEMORY_DIR, "view", "SELF.md"), editable: true },
  { id: "user", label: "USER", path: join(MEMORY_DIR, "view", "USER.md"), editable: true },
] as const;

export async function listMemory(): Promise<MemoryEntry[]> {
  const entries: MemoryEntry[] = [];
  for (const item of cognition) entries.push({ id: item.id, label: item.label, editable: item.editable, exists: await exists(item.path), kind: "cognition" });
  const dream = await latestDream();
  if (dream) entries.push({ id: `dream:${dream.name}`, label: dream.name.replace(/\.md$/, ""), editable: true, exists: true, kind: "dream" });
  for (const area of ["active", "candidates"] as const) {
    const directory = join(MEMORY_DIR, "skills", area);
    let skills: import("node:fs").Dirent[] = [];
    try { skills = await readdir(directory, { withFileTypes: true }); } catch {}
    for (const skill of skills) if (skill.isDirectory() && isSafeName(skill.name)) {
      const id = `skill:${area}:${skill.name}`;
      entries.push({ id, label: `${area}/${skill.name}`, editable: true, exists: await exists(join(directory, skill.name, "SKILL.md")), kind: "skill" });
    }
  }
  return entries;
}

export async function readMemory(id: string): Promise<Record<string, unknown>> {
  const entry = await resolveEntry(id);
  let content = "";
  try { content = await readFile(entry.path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { id, label: entry.label, editable: entry.editable, exists: Boolean(content), content };
}

export async function saveMemory(id: string, content: unknown): Promise<void> {
  const entry = await resolveEntry(id);
  if (!entry.editable) throw new HttpError(403, "BASE 由项目维护，只允许审查");
  if (typeof content !== "string") throw new HttpError(400, "content 必须是文本");
  if (Buffer.byteLength(content, "utf8") > 1_000_000) throw new HttpError(413, "文件内容过大");
  await writeTextAtomic(entry.path, content);
}

async function resolveEntry(id: string): Promise<{ path: string; label: string; editable: boolean }> {
  const item = cognition.find((value) => value.id === id);
  if (item) return item;
  if (id.startsWith("dream:")) {
    const name = id.slice(6);
    if (!/^DREAM \d{4}-\d{1,2}-\d{1,2}\.md$/.test(name)) throw new HttpError(400, "Dream 文件名无效");
    return { path: join(MEMORY_DIR, "logs", name), label: name.replace(/\.md$/, ""), editable: true };
  }
  const match = /^skill:(active|candidates):([a-zA-Z0-9_-]+)$/.exec(id);
  if (match?.[1] && match[2]) return { path: join(MEMORY_DIR, "skills", match[1], match[2], "SKILL.md"), label: `${match[1]}/${match[2]}`, editable: true };
  throw new HttpError(404, "未找到该记忆文件");
}

async function latestDream(): Promise<{ name: string } | null> {
  const directory = join(MEMORY_DIR, "logs");
  let names: string[] = [];
  try { names = await readdir(directory); } catch { return null; }
  const matching = names.filter((name) => /^DREAM \d{4}-\d{1,2}-\d{1,2}\.md$/.test(name)).sort().reverse();
  return matching[0] ? { name: matching[0] } : null;
}

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch { return false; }
}

function isSafeName(value: string): boolean { return basename(value) === value && /^[a-zA-Z0-9_-]+$/.test(value); }

