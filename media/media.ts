import { createHash } from "node:crypto";
import type { MediaConfig } from "./config.ts";
import { MediaFiles } from "./files/index.ts";
import { detectMimeType } from "./files/mime.ts";
import { createMediaModels } from "./models/index.ts";
import {
  MediaError,
  type MediaArtifact,
  type MediaConstraints,
  type MediaData,
  type MediaGenerateRequest,
  type MediaInput,
  type MediaKind,
  type MediaLibraryIndex,
  type MediaListRequest,
  type MediaModels,
  type MediaRecognition,
  type MediaService,
  type MediaServiceStatus,
  type ResolvedMedia,
} from "./type.ts";

export class Media implements MediaService {
  readonly #models: MediaModels;
  readonly #files: MediaFiles;

  constructor(readonly config: MediaConfig, models = createMediaModels(config), files = new MediaFiles(config)) {
    this.#models = models;
    this.#files = files;
  }

  async status(): Promise<MediaServiceStatus> {
    return {
      recognition: { image: this.#models.canRecognize("image"), audio: this.#models.canRecognize("audio") },
      generation: { image: this.#models.canGenerate("image"), audio: this.#models.canGenerate("audio") },
      libraryKinds: await this.#files.libraryKinds(),
    };
  }

  async list(request: MediaListRequest): Promise<MediaLibraryIndex> {
    return this.#files.listLibrary(request.kind);
  }

  async recognize(input: MediaData, signal?: AbortSignal): Promise<MediaRecognition> {
    validateMediaData(input, this.config.maxInputBytes);
    if (input.kind !== "image" && input.kind !== "audio") throw new MediaError("MEDIA_UNSUPPORTED", `Recognition is not supported for ${input.kind}`);
    if (!this.#models.canRecognize(input.kind)) throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${input.kind} recognition model is unavailable`);
    const text = (await this.#models.recognize(input, signal)).trim();
    if (!text) throw new MediaError("MEDIA_PROVIDER_FAILED", "Media recognition returned an empty explanation");
    return {
      media: {
        version: 1, kind: input.kind, mimeType: input.mimeType,
        ...(input.fileName ? { fileName: input.fileName } : {}),
        size: input.data.byteLength, sha256: createHash("sha256").update(input.data).digest("hex"), origin: { type: "imported" },
      },
      text,
      provider: this.#models.id,
    };
  }

  async generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaArtifact> {
    const text = request.text.trim();
    if (!text) throw new MediaError("MEDIA_INVALID_REQUEST", "Generation text must not be empty");
    if (text.length > 10_000) throw new MediaError("MEDIA_INVALID_REQUEST", "Generation text exceeds 10000 characters");
    if (!this.#models.canGenerate(request.kind)) throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${request.kind} generation model is unavailable`);
    const generated = await this.#models.generate({ ...request, text }, signal);
    if (generated.kind !== request.kind) throw new MediaError("MEDIA_PROVIDER_FAILED", `Model returned ${generated.kind} for ${request.kind} generation`);
    validateMediaData(generated, this.config.maxGeneratedBytes);
    return this.#files.saveGenerated(generated);
  }

  async resolve(input: MediaInput, constraints: MediaConstraints = {}): Promise<ResolvedMedia> {
    return input.source === "artifact"
      ? this.#files.resolveGenerated(input.mediaId, constraints)
      : this.#files.resolveLibrary(input, constraints);
  }

  async inspect(mediaId: string): Promise<MediaArtifact | undefined> { return this.#files.inspect(mediaId); }
}

export function parseMediaInput(value: unknown): MediaInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MediaError("MEDIA_INVALID_REQUEST", "media must be an object");
  const input = value as Record<string, unknown>;
  if (input.source === "artifact") return { source: "artifact", mediaId: requiredString(input.mediaId, "media.mediaId") };
  if (input.source === "library") {
    if (input.selection !== undefined && input.selection !== "random" && input.selection !== "best") {
      throw new MediaError("MEDIA_INVALID_REQUEST", "media.selection must be random or best");
    }
    return {
      source: "library",
      kind: requiredMediaKind(input.kind, "media.kind"),
      category: requiredString(input.category, "media.category"),
      tag: requiredString(input.tag, "media.tag"),
      ...(input.selection ? { selection: input.selection } : {}),
    };
  }
  throw new MediaError("MEDIA_INVALID_REQUEST", "media.source must be artifact or library");
}

export function mediaErrorResult(error: unknown): { status: "error"; code: string; message: string } {
  if (error instanceof MediaError) return { status: "error", code: error.code, message: error.message };
  return { status: "error", code: "MEDIA_INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
}

function validateMediaData(input: MediaData, maxBytes: number): void {
  if (!input.data.byteLength) throw new MediaError("MEDIA_INVALID_REQUEST", "Media data is empty");
  if (input.data.byteLength > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", `Media exceeds ${maxBytes} bytes`);
  const detected = detectMimeType(input.data, input.fileName);
  if (detected.kind !== "file" && detected.kind !== input.kind) throw new MediaError("MEDIA_INVALID_REQUEST", `Media bytes are ${detected.kind}, not ${input.kind}`);
  const prefix = input.kind === "image" ? "image/" : input.kind === "audio" ? "audio/" : undefined;
  if (prefix && !input.mimeType.startsWith(prefix)) throw new MediaError("MEDIA_INVALID_REQUEST", `MIME type does not match ${input.kind}`);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new MediaError("MEDIA_INVALID_REQUEST", `${name} must be a non-empty string`);
  return value.trim();
}

function requiredMediaKind(value: unknown, name: string): MediaKind {
  const kind = requiredString(value, name);
  if (kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "file") {
    throw new MediaError("MEDIA_INVALID_REQUEST", `${name} must be image, audio, video, or file`);
  }
  return kind;
}
