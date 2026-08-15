import { createHash, randomInt } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MediaConfig } from "./config.ts";
import { MediaError } from "./errors.ts";
import { detectMimeType, mediaTypeFromFileName } from "./mime.ts";
import type { MediaArtifact, MediaConstraints, MediaKind, MediaLibraryIndex, MediaLibraryInput, ResolvedMedia } from "./type.ts";

export class MediaLibrary {
  readonly #config: MediaConfig;

  constructor(config: MediaConfig) { this.#config = config; }

  names(): string[] { return Object.keys(this.#config.libraries).sort(); }

  async list(libraryName: string, kind?: MediaKind): Promise<MediaLibraryIndex> {
    const config = this.#config.libraries[libraryName];
    if (!config) throw new MediaError("MEDIA_NOT_FOUND", `Unknown media library: ${libraryName}`);
    const root = await realpath(config.path).catch(() => undefined);
    if (!root) return { library: libraryName, revision: revision([]), categories: [] };
    const entries = await readdir(root, { withFileTypes: true });
    const categories = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const files = await this.#files(root, entry.name, config.kinds, kind);
      if (!files.length) continue;
      categories.push({ name: entry.name, count: files.length, kinds: [...new Set(files.map((file) => file.kind))].sort() });
    }
    return { library: libraryName, revision: revision(categories), categories };
  }

  async resolve(input: MediaLibraryInput, constraints: MediaConstraints = {}): Promise<ResolvedMedia> {
    const config = this.#config.libraries[input.library];
    if (!config) throw new MediaError("MEDIA_NOT_FOUND", `Unknown media library: ${input.library}`);
    const index = await this.list(input.library);
    if (input.revision && input.revision !== index.revision) throw new MediaError("MEDIA_LIBRARY_CHANGED", `Media library changed: ${input.library}`);
    if (!index.categories.some((category) => category.name === input.category)) {
      throw new MediaError("MEDIA_NOT_FOUND", `Unknown category in ${input.library}: ${input.category}`);
    }
    const root = await realpath(config.path);
    const files = (await this.#files(root, input.category, config.kinds)).filter((file) => accepts(file.kind, file.mimeType, file.size, constraints));
    if (!files.length) throw new MediaError("MEDIA_UNSUPPORTED", `No media in ${input.library}/${input.category} satisfies adapter constraints`);
    const selected = input.selection === "best" ? files[0] : files[randomInt(files.length)];
    if (!selected) throw new MediaError("MEDIA_NOT_FOUND", "No media file was selected");
    const data = await readFile(selected.path);
    const detected = detectMimeType(data, selected.name);
    if (detected.kind !== selected.kind || detected.mimeType !== selected.mimeType) throw new MediaError("MEDIA_INVALID_REQUEST", `Media signature does not match its file type: ${selected.name}`);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const artifact: MediaArtifact = {
      version: 1, id: `library_${sha256.slice(0, 24)}`, kind: selected.kind, mimeType: selected.mimeType,
      fileName: selected.name, size: data.byteLength, sha256, description: input.category,
      createdAt: Date.now(), origin: { type: "library", library: input.library, category: input.category },
    };
    return { artifact, data };
  }

  async #files(root: string, category: string, allowedKinds: readonly MediaKind[], requestedKind?: MediaKind) {
    if (!category || basename(category) !== category || category === "." || category === "..") throw new MediaError("MEDIA_INVALID_REQUEST", "Invalid media category");
    const categoryPath = await realpath(join(root, category)).catch(() => undefined);
    if (!categoryPath || (categoryPath !== root && !categoryPath.startsWith(`${root}\\`) && !categoryPath.startsWith(`${root}/`))) {
      throw new MediaError("MEDIA_INVALID_REQUEST", "Media category escapes its library root");
    }
    const entries = await readdir(categoryPath, { withFileTypes: true });
    const files: Array<{ name: string; path: string; kind: MediaKind; mimeType: string; size: number }> = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const type = mediaTypeFromFileName(entry.name);
      if (!type || !allowedKinds.includes(type.kind) || (requestedKind && type.kind !== requestedKind)) continue;
      const path = join(categoryPath, entry.name);
      const info = await stat(path);
      if (!info.isFile() || info.size <= 0 || info.size > this.#config.maxGeneratedBytes) continue;
      files.push({ name: entry.name, path, ...type, size: info.size });
    }
    return files;
  }
}

function revision(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16); }
function accepts(kind: MediaKind, mimeType: string, size: number, constraints: MediaConstraints): boolean {
  return (!constraints.kinds || constraints.kinds.includes(kind))
    && (!constraints.mimeTypes || constraints.mimeTypes.includes(mimeType))
    && (!constraints.maxBytes || size <= constraints.maxBytes)
    && !(mimeType === "image/gif" && constraints.image?.allowAnimated === false);
}
