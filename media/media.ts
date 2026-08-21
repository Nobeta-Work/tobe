import type { MediaConfig } from "./config.ts";
import { MediaFiles } from "./files/index.ts";
import { detectMimeType } from "./files/mime.ts";
import { createMediaModels } from "./models/index.ts";
import {
  MediaError,
  type ArtifactMediaRef,
  type MediaAnalysis,
  type MediaAnalyzeRequest,
  type MediaConstraints,
  type MediaData,
  type MediaGenerateRequest,
  type MediaKind,
  type MediaLibraryIndex,
  type MediaListRequest,
  type MediaMetadata,
  type MediaModels,
  type MediaRef,
  type MediaService,
  type MediaServiceStatus,
} from "./type.ts";

const DEFAULT_IMAGE_ANALYSIS_PROMPT = "请准确描述图片内容。若有多张图片，请在一次回答中比较它们。";
const DEFAULT_AUDIO_ANALYSIS_PROMPT = "请准确转录并说明音频内容。";
const DEFAULT_REFERENCE_GENERATION_PROMPT = "请依据提供的参考媒体生成新的内容。";

export class Media implements MediaService {
  readonly #models: MediaModels;
  readonly #files: MediaFiles;

  constructor(readonly config: MediaConfig, models = createMediaModels(config), files = new MediaFiles(config)) {
    this.#models = models;
    this.#files = files;
  }

  async status(): Promise<MediaServiceStatus> {
    return {
      analysis: { image: this.#models.canAnalyze("image"), audio: this.#models.canAnalyze("audio") },
      generation: { image: this.#models.canGenerate("image"), audio: this.#models.canGenerate("audio") },
      libraryKinds: await this.#files.libraryKinds(),
    };
  }

  async list(request: MediaListRequest): Promise<MediaLibraryIndex> {
    return this.#files.listLibrary(request.kind);
  }

  async import(input: MediaData, description = ""): Promise<ArtifactMediaRef> {
    validateMediaData(input, this.config.maxInputBytes);
    return this.#files.saveImported(input, description);
  }

  async analyze(request: MediaAnalyzeRequest, signal?: AbortSignal): Promise<MediaAnalysis> {
    if (!request.inputs.length) throw new MediaError("MEDIA_INVALID_REQUEST", "Analysis requires at least one media input");
    if (request.inputs.length > 8) throw new MediaError("MEDIA_INVALID_REQUEST", "Analysis accepts at most 8 media inputs");
    const inputs: MediaData[] = [];
    for (const input of request.inputs) {
      const data = isMediaRef(input) ? await this.resolve(input) : input;
      validateMediaData(data, this.config.maxInputBytes);
      if (data.kind !== "image" && data.kind !== "audio") {
        throw new MediaError("MEDIA_UNSUPPORTED", `Analysis is not supported for ${data.kind}`);
      }
      if (!this.#models.canAnalyze(data.kind)) {
        throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${data.kind} analysis model is unavailable`);
      }
      inputs.push(data);
    }
    const prompt = request.prompt?.trim() || defaultAnalysisPrompt(inputs);
    if (prompt.length > 10_000) throw new MediaError("MEDIA_INVALID_REQUEST", "Analysis prompt exceeds 10000 characters");
    const description = (await this.#models.analyze(inputs, prompt, signal)).trim();
    if (!description) throw new MediaError("MEDIA_PROVIDER_FAILED", "Media analysis returned an empty description");
    return { description, provider: this.#models.id, inputCount: inputs.length };
  }

  async generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<ArtifactMediaRef> {
    const references = await Promise.all((request.references ?? []).map((ref) => this.resolve(ref)));
    if (references.length > 4) throw new MediaError("MEDIA_INVALID_REQUEST", "Generation accepts at most 4 media references");
    const prompt = request.prompt?.trim() || (references.length ? DEFAULT_REFERENCE_GENERATION_PROMPT : "");
    if (!prompt) throw new MediaError("MEDIA_INVALID_REQUEST", "Generation requires a prompt or at least one reference");
    if (prompt.length > 10_000) throw new MediaError("MEDIA_INVALID_REQUEST", "Generation prompt exceeds 10000 characters");
    if (!this.#models.canGenerate(request.kind)) {
      throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${request.kind} generation model is unavailable`);
    }
    const generated = await this.#models.generate({
      kind: request.kind,
      prompt,
      references,
      ...(request.options ? { options: request.options } : {}),
    }, signal);
    if (generated.kind !== request.kind) {
      throw new MediaError("MEDIA_PROVIDER_FAILED", `Model returned ${generated.kind} for ${request.kind} generation`);
    }
    validateMediaData(generated, this.config.maxGeneratedBytes);
    return this.#files.saveGenerated(generated);
  }

  async resolve(ref: MediaRef, constraints: MediaConstraints = {}): Promise<MediaMetadata> {
    return this.#files.resolve(parseMediaRef(ref), constraints);
  }
}

export function parseMediaRef(value: unknown): MediaRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaError("MEDIA_INVALID_REQUEST", "media must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.type !== "media_ref") throw new MediaError("MEDIA_INVALID_REQUEST", "media.type must be media_ref");
  const kind = requiredMediaKind(input.kind, "media.kind");
  const description = requiredString(input.description, "media.description", true);
  if (input.source === "artifact") {
    rejectFields(input, ["category", "tag"]);
    return { type: "media_ref", source: "artifact", kind, id: requiredString(input.id, "media.id"), description };
  }
  if (input.source === "library") {
    rejectFields(input, ["id"]);
    return {
      type: "media_ref", source: "library", kind,
      category: requiredString(input.category, "media.category"),
      tag: requiredString(input.tag, "media.tag"),
      description,
    };
  }
  throw new MediaError("MEDIA_INVALID_REQUEST", "media.source must be artifact or library");
}

export function isMediaRef(value: unknown): value is MediaRef {
  try { parseMediaRef(value); return true; }
  catch { return false; }
}

export function isMediaMetadata(value: unknown): value is MediaMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Partial<MediaMetadata>;
  return input.data instanceof Uint8Array
    && typeof input.mimeType === "string"
    && typeof input.size === "number"
    && typeof input.sha256 === "string"
    && (input.kind === "image" || input.kind === "audio" || input.kind === "video" || input.kind === "file");
}

export function mediaErrorResult(error: unknown): { status: "error"; code: string; message: string } {
  if (error instanceof MediaError) return { status: "error", code: error.code, message: error.message };
  return { status: "error", code: "MEDIA_INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
}

function validateMediaData(input: MediaData, maxBytes: number): void {
  if (!(input.data instanceof Uint8Array) || !input.data.byteLength) throw new MediaError("MEDIA_INVALID_REQUEST", "Media data is empty");
  if (input.data.byteLength > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", `Media exceeds ${maxBytes} bytes`);
  const detected = detectMimeType(input.data, input.fileName);
  if (detected.kind !== "file" && detected.kind !== input.kind) throw new MediaError("MEDIA_INVALID_REQUEST", `Media bytes are ${detected.kind}, not ${input.kind}`);
  const prefix = input.kind === "image" ? "image/" : input.kind === "audio" ? "audio/" : undefined;
  if (prefix && !input.mimeType.startsWith(prefix)) throw new MediaError("MEDIA_INVALID_REQUEST", `MIME type does not match ${input.kind}`);
}

function defaultAnalysisPrompt(inputs: readonly MediaData[]): string {
  return inputs.every((input) => input.kind === "audio") ? DEFAULT_AUDIO_ANALYSIS_PROMPT : DEFAULT_IMAGE_ANALYSIS_PROMPT;
}

function requiredString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new MediaError("MEDIA_INVALID_REQUEST", `${name} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value.trim();
}

function requiredMediaKind(value: unknown, name: string): MediaKind {
  const kind = requiredString(value, name);
  if (kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "file") {
    throw new MediaError("MEDIA_INVALID_REQUEST", `${name} must be image, audio, video, or file`);
  }
  return kind;
}

function rejectFields(input: Record<string, unknown>, fields: readonly string[]): void {
  const present = fields.find((field) => input[field] !== undefined);
  if (present) throw new MediaError("MEDIA_INVALID_REQUEST", `media.${present} is not allowed for ${String(input.source)} refs`);
}
