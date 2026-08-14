import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MEMORY_DIR = dirname(fileURLToPath(import.meta.url));
const BASE_PATH = join(MEMORY_DIR, "BASE.md");
const IDENTITY_PATH = join(MEMORY_DIR, "IDENTITY.md");
const SELF_PATH = join(MEMORY_DIR, "view", "SELF.md");
const USER_PATH = join(MEMORY_DIR, "view", "USER.md");
const MEMORY_SKILL_PATH = join(MEMORY_DIR, "SKILL.md");
const ACTIVE_SKILLS_DIR = join(MEMORY_DIR, "skills", "active");
const CANDIDATE_SKILLS_DIR = join(MEMORY_DIR, "skills", "candidates");
const LOGS_DIR = join(MEMORY_DIR, "logs");
const DREAM_PREFIX = "DREAM ";
const DREAM_HOUR = 2;

export default function memoryExtension(pi: ExtensionAPI): void {
  let dreamTimer: ReturnType<typeof setTimeout> | undefined;
  let dreamQueuedFor: string | undefined;

  pi.on("resources_discover", () => ({
    skillPaths: [MEMORY_SKILL_PATH, ACTIVE_SKILLS_DIR],
  }));

  pi.on("before_agent_start", async (event) => {
    const [base, identity, self, user] = await Promise.all([
      readRequiredText(BASE_PATH),
      readOptionalText(IDENTITY_PATH),
      readOptionalText(SELF_PATH),
      readOptionalText(USER_PATH),
    ]);
    return { systemPrompt: buildMemoryPrompt(event.systemPrompt, base, identity, self, user) };
  });

  pi.on("session_start", async () => {
    clearDreamTimer();
    await Promise.all([
      mkdir(ACTIVE_SKILLS_DIR, { recursive: true }),
      mkdir(CANDIDATE_SKILLS_DIR, { recursive: true }),
      mkdir(LOGS_DIR, { recursive: true }),
    ]);
    const now = new Date();
    const todayDreamAt = dreamAt(now);
    const latestDueDream = new Date(todayDreamAt);
    if (now.getTime() < todayDreamAt.getTime()) latestDueDream.setDate(latestDueDream.getDate() - 1);
    if (await hasAnyDreamRecord() && !(await hasCompletedDream(latestDueDream))) {
      queueDream(latestDueDream);
    }
    scheduleNextDream(now);
  });

  pi.on("session_shutdown", () => {
    clearDreamTimer();
    dreamQueuedFor = undefined;
  });

  function queueDream(day: Date): void {
    const date = formatLocalDate(day);
    if (dreamQueuedFor === date) return;
    dreamQueuedFor = date;
    pi.sendMessage({
      customType: "memory.dream",
      content: buildDreamPrompt(date),
      display: false,
      details: { date, internal: true },
    }, { deliverAs: "followUp", triggerTurn: true });
  }

  function scheduleNextDream(now: Date): void {
    const next = dreamAt(now);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    const delay = Math.min(next.getTime() - now.getTime(), 2_147_000_000);
    dreamTimer = setTimeout(() => {
      dreamTimer = undefined;
      void hasCompletedDream(next).then((completed) => {
        if (!completed) queueDream(next);
        scheduleNextDream(new Date());
      });
    }, delay);
  }

  function clearDreamTimer(): void {
    if (dreamTimer) clearTimeout(dreamTimer);
    dreamTimer = undefined;
  }
}

export function buildMemoryPrompt(piBase: string, base: string, identity: string, self: string, user: string): string {
  const sections = [
    "# Pi Agent Core",
    piBase,
    "# ToBe Persistent Cognition",
    "The tracked BASE defines ToBe's shared cognition. Optional instance-owned Memory files add persistent identity and lived understanding. Together they override conflicting transient persona descriptions, while the Pi Agent Core above continues to govern runtime capabilities, tools, and operational constraints.",
    wrap("BASE", base),
    identity ? wrap("IDENTITY", identity) : "",
    self ? wrap("SELF", self) : "",
    user ? wrap("USER", user) : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function buildDreamPrompt(date: string): string {
  return `[ToBe internal activity: Dream ${date}]\n\nThis is an internal Memory activity, not a user message. Do not answer the user and do not send its contents through Awareness.\n\nReview the recent facts, decisions, feedback, actions, tool results, and completed work visible in the current context. Form only impressions that should continue to affect ToBe in the future. You may incrementally update memory/view/SELF.md and memory/view/USER.md, but do not force a change. Check completed work for repeated, common, reusable procedures: place new or insufficiently verified abilities in memory/skills/candidates/<name>/SKILL.md; only keep demonstrably stable abilities in memory/skills/active/. Never include credentials, temporary paths, or mere task status as a Skill.\n\nDo not treat this Dream instruction or prior Dream prose as a new lived fact. It is valid to conclude that nothing should change.\n\nOnly after all review work is complete, keep exactly one Dream record under memory/logs: reuse/rename and overwrite the existing DREAM *.md file as memory/logs/DREAM ${date}.md. Write a concise internal account of impressions and actual file changes; if nothing changed, say so. The non-empty dated file is the completion marker for startup catch-up.`;
}

export function formatLocalDate(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
}

function dreamAt(value: Date): Date {
  const result = new Date(value);
  result.setHours(DREAM_HOUR, 0, 0, 0);
  return result;
}

async function hasCompletedDream(day: Date): Promise<boolean> {
  const expectedName = `${DREAM_PREFIX}${formatLocalDate(day)}.md`;
  let entries: string[];
  try { entries = await readdir(LOGS_DIR); }
  catch { return false; }
  const matching = entries.find((name) => name === expectedName);
  if (!matching) return false;
  try { return (await stat(join(LOGS_DIR, matching))).size > 0; }
  catch { return false; }
}

export async function hasAnyDreamRecord(logsDir = LOGS_DIR): Promise<boolean> {
  let entries: string[];
  try { entries = await readdir(logsDir); }
  catch { return false; }
  return entries.some((name) => /^DREAM \d{4}-\d{1,2}-\d{1,2}\.md$/.test(name));
}

async function readRequiredText(path: string): Promise<string> {
  const content = (await readFile(path, "utf8")).trim();
  if (!content) throw new Error(`Memory identity is empty: ${path}`);
  return content;
}

async function readOptionalText(path: string): Promise<string> {
  try { return (await readFile(path, "utf8")).trim(); }
  catch { return ""; }
}

function wrap(name: string, content: string): string {
  return `<tobe-${name.toLowerCase()}>\n${content}\n</tobe-${name.toLowerCase()}>`;
}
