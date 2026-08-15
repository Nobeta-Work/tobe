import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { MediaConfig } from "../config.ts";
import {
  MediaError,
  type GeneratedMedia,
  type MediaArtifact,
  type MediaConstraints,
  type MediaKind,
  type MediaLibraryIndex,
  type MediaLibraryInput,
  type ResolvedMedia,
} from "../type.ts";
import { detectMimeType, extensionForMime, mediaTypeFromFileName } from "./mime.ts";

const KEY_PATTERN = /^\d{8}-[a-z0-9]{2}-$/i;
const KEY_LENGTH = 12;
const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DESCRIPTION_MAX_LENGTH = 80;
const MEDIA_KINDS: readonly MediaKind[] = ["image", "audio", "video", "file"];

export class MediaFiles {
  constructor(readonly config: MediaConfig) {}

  async libraryKinds(): Promise<MediaKind[]> {
    const kinds: MediaKind[] = [];
    for (const kind of MEDIA_KINDS) {
      const index = await this.listLibrary(kind);
      if (Object.keys(index.categories).length) kinds.push(kind);
    }
    return kinds;
  }

  async listLibrary(kind: MediaKind): Promise<MediaLibraryIndex> {
    const kindRoot = await realpath(join(this.config.libDir, kind)).catch(() => undefined);
    if (!kindRoot) return { kind, categories: {} };
    const categories: Record<string, string[]> = {};
    for (const categoryEntry of sorted(await readdir(kindRoot, { withFileTypes: true }))) {
      if (!categoryEntry.isDirectory() || categoryEntry.isSymbolicLink()) continue;
      const categoryPath = join(kindRoot, categoryEntry.name);
      const tags: string[] = [];
      for (const tagEntry of sorted(await readdir(categoryPath, { withFileTypes: true }).catch(() => []))) {
        if (!tagEntry.isDirectory() || tagEntry.isSymbolicLink()) continue;
        const files = await this.#libraryFiles(kindRoot, categoryEntry.name, tagEntry.name, kind);
        if (files.length) tags.push(tagEntry.name);
      }
      if (tags.length) categories[categoryEntry.name] = tags;
    }
    return { kind, categories };
  }

  async saveGenerated(media: GeneratedMedia): Promise<MediaArtifact> {
    this.#validateSize(media.data, this.config.maxGeneratedBytes);
    const directory = join(this.config.dataDir, media.kind);
    await mkdir(directory, { recursive: true });
    const description = sanitizeDescription(media.description);
    const extension = extensionForMime(media.mimeType);

    for (let attempt = 0; attempt < 128; attempt += 1) {
      const key = generatedKey();
      const lockPath = join(directory, `.${key}.lock`);
      try {
        await writeFile(lockPath, "", { flag: "wx" });
      } catch (error) {
        if (hasCode(error, "EEXIST")) continue;
        throw error;
      }
      try {
        const entries = await readdir(directory);
        if (entries.some((name) => !name.startsWith(".") && name.startsWith(key))) continue;
        await writeFile(join(directory, `${key}${description}${extension}`), media.data, { flag: "wx" });
        const sha256 = createHash("sha256").update(media.data).digest("hex");
        return this.#artifact(media.kind, media.mimeType, undefined, media.data.byteLength, sha256, {
          type: "generated", provider: media.provider,
        }, `${media.kind}:${key}`);
      } finally {
        await unlink(lockPath).catch(() => undefined);
      }
    }
    throw new MediaError("MEDIA_PROVIDER_FAILED", "Could not allocate a unique generated media key");
  }

  async resolveGenerated(mediaId: string, constraints: MediaConstraints = {}): Promise<ResolvedMedia> {
    const separator = mediaId.indexOf(":");
    const kind = mediaId.slice(0, separator) as MediaKind;
    const key = mediaId.slice(separator + 1, separator + 1 + KEY_LENGTH);
    if (separator < 1 || !MEDIA_KINDS.includes(kind) || !KEY_PATTERN.test(key)) {
      throw new MediaError("MEDIA_INVALID_REQUEST", "Invalid generated media key");
    }
    const directory = join(this.config.dataDir, kind);
    const matches = sorted(await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.startsWith(key));
    if (matches.length > 1) throw new MediaError("MEDIA_INVALID_REQUEST", `Generated media key is ambiguous: ${kind}:${key}`);
    const entry = matches[0];
    if (!entry) throw new MediaError("MEDIA_NOT_FOUND", `Generated media is unavailable: ${kind}:${key}`);
    return this.#readResolved(join(directory, entry.name), kind, { type: "generated" }, constraints, `${kind}:${key}`, true);
  }

  async resolveLibrary(input: MediaLibraryInput, constraints: MediaConstraints = {}): Promise<ResolvedMedia> {
    const kindRoot = await realpath(join(this.config.libDir, input.kind)).catch(() => undefined);
    if (!kindRoot) throw new MediaError("MEDIA_NOT_FOUND", `Media library kind is unavailable: ${input.kind}`);
    const files = (await this.#libraryFiles(kindRoot, input.category, input.tag, input.kind))
      .filter((file) => accepts(file.kind, file.mimeType, file.size, constraints));
    if (!files.length) throw new MediaError("MEDIA_NOT_FOUND", `No usable media in ${input.kind}/${input.category}/${input.tag}`);
    const selected = input.selection === "best" ? files[0] : files[randomInt(files.length)];
    if (!selected) throw new MediaError("MEDIA_NOT_FOUND", "No media file was selected");
    return this.#readResolved(selected.path, selected.kind, {
      type: "library", category: input.category, tag: input.tag,
    }, constraints);
  }

  async inspect(mediaId: string): Promise<MediaArtifact | undefined> {
    try { return (await this.resolveGenerated(mediaId)).artifact; }
    catch (error) { if (error instanceof MediaError && error.code === "MEDIA_NOT_FOUND") return undefined; throw error; }
  }

  async #readResolved(
    path: string,
    expectedKind: MediaKind,
    origin: MediaArtifact["origin"],
    constraints: MediaConstraints,
    forcedId?: string,
    hideFileName = false,
  ): Promise<ResolvedMedia> {
    const info = await stat(path);
    this.#validateSize({ byteLength: info.size }, constraints.maxBytes ?? this.config.maxGeneratedBytes);
    const data = await readFile(path);
    const detected = detectMimeType(data, path);
    if (detected.kind !== expectedKind) throw new MediaError("MEDIA_INVALID_REQUEST", `Media signature does not match ${expectedKind}`);
    if (!accepts(detected.kind, detected.mimeType, data.byteLength, constraints)) throw new MediaError("MEDIA_UNSUPPORTED", `Adapter does not accept ${detected.mimeType}`);
    const sha256 = createHash("sha256").update(data).digest("hex");
    return {
      artifact: this.#artifact(detected.kind, detected.mimeType, hideFileName ? undefined : basename(path), data.byteLength, sha256, origin, forcedId),
      data,
    };
  }

  #artifact(
    kind: MediaKind,
    mimeType: string,
    fileName: string | undefined,
    size: number,
    sha256: string,
    origin: MediaArtifact["origin"],
    forcedId?: string,
  ): MediaArtifact {
    return {
      version: 1,
      id: forcedId ?? `library:${sha256}`,
      kind,
      mimeType,
      ...(fileName ? { fileName } : {}),
      size,
      sha256,
      origin,
    };
  }

  async #libraryFiles(root: string, category: string, tag: string, expectedKind: MediaKind) {
    validateSegment(category, "category");
    validateSegment(tag, "tag");
    const tagPath = await realpath(join(root, category, tag)).catch(() => undefined);
    if (!tagPath) return [];
    assertContained(root, tagPath);
    const files: Array<{ name: string; path: string; kind: MediaKind; mimeType: string; size: number }> = [];
    for (const entry of sorted(await readdir(tagPath, { withFileTypes: true }))) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const type = mediaTypeFromFileName(entry.name);
      if (!type || type.kind !== expectedKind) continue;
      const path = join(tagPath, entry.name);
      const info = await stat(path);
      if (info.isFile() && info.size > 0 && info.size <= this.config.maxGeneratedBytes) files.push({ name: entry.name, path, ...type, size: info.size });
    }
    return files;
  }

  #validateSize(value: { byteLength: number }, maxBytes: number): void {
    if (!value.byteLength) throw new MediaError("MEDIA_INVALID_REQUEST", "Media data is empty");
    if (value.byteLength > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", `Media exceeds ${maxBytes} bytes`);
  }
}

function generatedKey(date = new Date()): string {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `${day}-${KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]}${KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]}-`;
}

function sanitizeDescription(value: string | undefined): string {
  if (!value) return "";
  return value.normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, DESCRIPTION_MAX_LENGTH);
}

function validateSegment(value: string, label: string): void {
  if (!value || basename(value) !== value || value === "." || value === "..") {
    throw new MediaError("MEDIA_INVALID_REQUEST", `Invalid media ${label}`);
  }
}

function assertContained(root: string, candidate: string): void {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new MediaError("MEDIA_INVALID_REQUEST", "Media path escapes its library root");
  }
}

function sorted<T extends { name: string }>(entries: T[]): T[] {
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function accepts(kind: MediaKind, mimeType: string, size: number, constraints: MediaConstraints): boolean {
  return (!constraints.kinds || constraints.kinds.includes(kind))
    && (!constraints.mimeTypes || constraints.mimeTypes.includes(mimeType))
    && (!constraints.maxBytes || size <= constraints.maxBytes)
    && !(mimeType === "image/gif" && constraints.image?.allowAnimated === false);
}
