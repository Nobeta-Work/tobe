import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MediaError } from "./errors.ts";
import { extensionForMime } from "./mime.ts";
import type { GeneratedMedia, MediaArtifact, ResolvedMedia } from "./type.ts";

interface StoredArtifact { artifact: MediaArtifact; path: string }

export class MediaStore {
  readonly #directory: string;
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  readonly #artifacts = new Map<string, StoredArtifact>();

  constructor(directory: string, ttlMs: number, maxBytes: number) {
    this.#directory = join(directory, "artifacts");
    this.#ttlMs = ttlMs;
    this.#maxBytes = maxBytes;
  }

  async save(media: GeneratedMedia): Promise<MediaArtifact> {
    if (!media.data.byteLength) throw new MediaError("MEDIA_PROVIDER_FAILED", "Generated media is empty");
    if (media.data.byteLength > this.#maxBytes) throw new MediaError("MEDIA_TOO_LARGE", `Generated media exceeds ${this.#maxBytes} bytes`);
    await mkdir(this.#directory, { recursive: true });
    const id = `media_${randomUUID().replaceAll("-", "")}`;
    const fileName = `${id}${extensionForMime(media.mimeType)}`;
    const path = join(this.#directory, fileName);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, media.data, { flag: "wx" });
    await rename(temporary, path);
    const now = Date.now();
    const artifact: MediaArtifact = {
      version: 1, id, kind: media.kind, mimeType: media.mimeType,
      fileName: media.fileName ?? fileName, size: media.data.byteLength,
      sha256: createHash("sha256").update(media.data).digest("hex"),
      ...(media.description ? { description: media.description } : {}),
      createdAt: now, expiresAt: now + this.#ttlMs,
      origin: { type: "generated", provider: media.provider },
    };
    this.#artifacts.set(id, { artifact, path });
    return artifact;
  }

  async inspect(id: string): Promise<MediaArtifact | undefined> {
    const stored = this.#artifacts.get(id);
    if (!stored) return undefined;
    if (stored.artifact.expiresAt !== undefined && stored.artifact.expiresAt <= Date.now()) {
      this.#artifacts.delete(id);
      return undefined;
    }
    return stored.artifact;
  }

  async resolve(id: string): Promise<ResolvedMedia> {
    const stored = this.#artifacts.get(id);
    if (!stored) throw new MediaError("MEDIA_NOT_FOUND", `Unknown media artifact: ${id}`);
    if (stored.artifact.expiresAt !== undefined && stored.artifact.expiresAt <= Date.now()) {
      this.#artifacts.delete(id);
      throw new MediaError("MEDIA_EXPIRED", `Media artifact has expired: ${id}`);
    }
    const info = await stat(stored.path).catch(() => undefined);
    if (!info?.isFile()) throw new MediaError("MEDIA_NOT_FOUND", `Media artifact data is unavailable: ${id}`);
    if (info.size !== stored.artifact.size || info.size > this.#maxBytes) throw new MediaError("MEDIA_INVALID_REQUEST", `Media artifact size changed: ${id}`);
    const data = await readFile(stored.path);
    const digest = createHash("sha256").update(data).digest("hex");
    if (digest !== stored.artifact.sha256) throw new MediaError("MEDIA_INVALID_REQUEST", `Media artifact checksum mismatch: ${id}`);
    return { artifact: stored.artifact, data };
  }
}
