import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { MediaConfig } from "../config.ts";
import {
  MediaError,
  type ArtifactMediaRef,
  type GeneratedMedia,
  type LibraryMediaRef,
  type MediaConstraints,
  type MediaData,
  type MediaKind,
  type MediaLibraryIndex,
  type MediaMetadata,
  type MediaRef,
} from "../type.ts";
import { detectMimeType, extensionForMime, mediaTypeFromFileName } from "./mime.ts";

const ID_PATTERN = /^\d{8}-[a-z0-9]{2}-$/i;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DESCRIPTION_MAX_LENGTH = 80;
const MEDIA_KINDS: readonly MediaKind[] = ["image", "audio", "video", "file"];

export class MediaFiles {
  constructor(readonly config: MediaConfig) {}

  async libraryKinds(): Promise<MediaKind[]> {
    const kinds: MediaKind[] = [];
    for (const kind of MEDIA_KINDS) {
      if (Object.keys((await this.listLibrary(kind)).categories).length) kinds.push(kind);
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
        if ((await this.#libraryFiles(kindRoot, categoryEntry.name, tagEntry.name, kind)).length) tags.push(tagEntry.name);
      }
      if (tags.length) categories[categoryEntry.name] = tags;
    }
    return { kind, categories };
  }

  async saveImported(media: MediaData, description = ""): Promise<ArtifactMediaRef> {
    this.#validateSize(media.data, this.config.maxInputBytes);
    return this.#saveArtifact(media, description);
  }

  async saveGenerated(media: GeneratedMedia): Promise<ArtifactMediaRef> {
    this.#validateSize(media.data, this.config.maxGeneratedBytes);
    return this.#saveArtifact(media, media.description ?? "");
  }

  async resolve(ref: MediaRef, constraints: MediaConstraints = {}): Promise<MediaMetadata> {
    return ref.source === "artifact"
      ? this.#resolveArtifact(ref, constraints)
      : this.#resolveLibrary(ref, constraints);
  }

  async #saveArtifact(media: MediaData, rawDescription: string): Promise<ArtifactMediaRef> {
    const detected = detectMimeType(media.data, media.fileName);
    if (detected.kind !== "file" && detected.kind !== media.kind) {
      throw new MediaError("MEDIA_INVALID_REQUEST", `Media bytes are ${detected.kind}, not ${media.kind}`);
    }
    const directory = join(this.config.dataDir, media.kind);
    await mkdir(directory, { recursive: true });
    const id = generatedId();
    const description = sanitizeDescription(rawDescription);
    const extension = extensionForMime(media.mimeType);
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.startsWith(id)) {
        await unlink(join(directory, entry.name));
      }
    }
    await writeFile(join(directory, `${id}${description}${extension}`), media.data);
    return { type: "media_ref", source: "artifact", kind: media.kind, id, description };
  }

  async #resolveArtifact(ref: ArtifactMediaRef, constraints: MediaConstraints): Promise<MediaMetadata> {
    if (!ID_PATTERN.test(ref.id)) throw new MediaError("MEDIA_INVALID_REQUEST", "Invalid artifact media id");
    const directory = join(this.config.dataDir, ref.kind);
    const matches = sorted(await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.startsWith(ref.id));
    if (matches.length > 1) throw new MediaError("MEDIA_INVALID_REQUEST", `Artifact media id is ambiguous: ${ref.kind}:${ref.id}`);
    const entry = matches[0];
    if (!entry) throw new MediaError("MEDIA_NOT_FOUND", `Artifact media is unavailable: ${ref.kind}:${ref.id}`);
    return this.#readMetadata(join(directory, entry.name), ref.kind, constraints, false);
  }

  async #resolveLibrary(ref: LibraryMediaRef, constraints: MediaConstraints): Promise<MediaMetadata> {
    const kindRoot = await realpath(join(this.config.libDir, ref.kind)).catch(() => undefined);
    if (!kindRoot) throw new MediaError("MEDIA_NOT_FOUND", `Media library kind is unavailable: ${ref.kind}`);
    const files = (await this.#libraryFiles(kindRoot, ref.category, ref.tag, ref.kind))
      .filter((file) => accepts(file.kind, file.mimeType, file.size, constraints));
    if (!files.length) throw new MediaError("MEDIA_NOT_FOUND", `No usable media in ${ref.kind}/${ref.category}/${ref.tag}`);
    const selected = files[randomInt(files.length)];
    if (!selected) throw new MediaError("MEDIA_NOT_FOUND", "No media file was selected");
    return this.#readMetadata(selected.path, selected.kind, constraints, true);
  }

  async #readMetadata(path: string, expectedKind: MediaKind, constraints: MediaConstraints, exposeFileName: boolean): Promise<MediaMetadata> {
    const info = await stat(path);
    this.#validateSize({ byteLength: info.size }, constraints.maxBytes ?? this.config.maxGeneratedBytes);
    const data = await readFile(path);
    const detected = detectMimeType(data, path);
    if (detected.kind !== expectedKind) throw new MediaError("MEDIA_INVALID_REQUEST", `Media signature does not match ${expectedKind}`);
    if (!accepts(detected.kind, detected.mimeType, data.byteLength, constraints)) {
      throw new MediaError("MEDIA_UNSUPPORTED", `Adapter does not accept ${detected.mimeType}`);
    }
    return {
      kind: detected.kind,
      mimeType: detected.mimeType,
      data,
      ...(exposeFileName ? { fileName: basename(path) } : {}),
      size: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
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

export function mediaRefKey(ref: MediaRef): string {
  return ref.source === "artifact"
    ? `${ref.kind}:${ref.id}`
    : `${ref.kind}:${ref.category}:${ref.tag}`;
}

function generatedId(date = new Date()): string {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `${day}-${ID_ALPHABET[randomInt(ID_ALPHABET.length)]}${ID_ALPHABET[randomInt(ID_ALPHABET.length)]}-`;
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

function accepts(kind: MediaKind, mimeType: string, size: number, constraints: MediaConstraints): boolean {
  return (!constraints.kinds || constraints.kinds.includes(kind))
    && (!constraints.mimeTypes || constraints.mimeTypes.includes(mimeType))
    && (!constraints.maxBytes || size <= constraints.maxBytes)
    && !(mimeType === "image/gif" && constraints.image?.allowAnimated === false);
}
