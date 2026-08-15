import { createHash } from "node:crypto";
import type { MediaConfig } from "./config.ts";
import { MediaError } from "./errors.ts";
import { MediaLibrary } from "./library.ts";
import { detectMimeType } from "./mime.ts";
import { HttpMediaModelProvider } from "./provider.ts";
import { MediaStore } from "./store.ts";
import type {
  MediaArtifact,
  MediaConstraints,
  MediaData,
  MediaGenerateRequest,
  MediaInput,
  MediaLibraryIndex,
  MediaListRequest,
  MediaModelProvider,
  MediaRecognition,
  MediaService,
  MediaServiceStatus,
  ResolvedMedia,
} from "./type.ts";

export interface MediaServiceOptions {
  provider?: MediaModelProvider;
  store?: MediaStore;
  library?: MediaLibrary;
}

export class MediaServiceImpl implements MediaService {
  readonly #config: MediaConfig;
  readonly #provider: MediaModelProvider;
  readonly #store: MediaStore;
  readonly #library: MediaLibrary;

  constructor(config: MediaConfig, options: MediaServiceOptions = {}) {
    this.#config = config;
    this.#provider = options.provider ?? new HttpMediaModelProvider(config);
    this.#store = options.store ?? new MediaStore(config.dataDir, config.artifactTtlMs, config.maxGeneratedBytes);
    this.#library = options.library ?? new MediaLibrary(config);
  }

  async status(): Promise<MediaServiceStatus> {
    return {
      recognition: { image: this.#provider.supportsRecognition("image"), audio: this.#provider.supportsRecognition("audio") },
      generation: { image: this.#provider.supportsGeneration("image"), audio: this.#provider.supportsGeneration("audio") },
      libraries: this.#library.names(),
    };
  }

  async list(request: MediaListRequest = {}): Promise<MediaLibraryIndex[]> {
    const names = request.library ? [request.library] : this.#library.names();
    return Promise.all(names.map((name) => this.#library.list(name, request.kind)));
  }

  async recognize(input: MediaData, signal?: AbortSignal): Promise<MediaRecognition> {
    this.#validateData(input, this.#config.maxInputBytes);
    if (input.kind !== "image" && input.kind !== "audio") throw new MediaError("MEDIA_UNSUPPORTED", `Recognition is not supported for ${input.kind}`);
    if (!this.#provider.supportsRecognition(input.kind)) throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${input.kind} recognition provider is unavailable`);
    const text = (await this.#provider.recognize(input, signal)).trim();
    if (!text) throw new MediaError("MEDIA_PROVIDER_FAILED", "Media recognition returned an empty explanation");
    const digest = createHash("sha256").update(input.data).digest("hex");
    return {
      media: {
        version: 1, kind: input.kind, mimeType: input.mimeType,
        ...(input.fileName ? { fileName: input.fileName } : {}),
        size: input.data.byteLength, sha256: digest, origin: { type: "imported" },
      },
      text,
      provider: this.#provider.id,
    };
  }

  async generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaArtifact> {
    const text = request.text.trim();
    if (!text) throw new MediaError("MEDIA_INVALID_REQUEST", "Generation text must not be empty");
    if (!this.#provider.supportsGeneration(request.kind)) throw new MediaError("MEDIA_PROVIDER_UNAVAILABLE", `${request.kind} generation provider is unavailable`);
    const generated = await this.#provider.generate({ ...request, text }, signal);
    if (generated.kind !== request.kind) throw new MediaError("MEDIA_PROVIDER_FAILED", `Provider returned ${generated.kind} for ${request.kind} generation`);
    this.#validateData(generated, this.#config.maxGeneratedBytes);
    return this.#store.save(generated);
  }

  async resolve(input: MediaInput, constraints: MediaConstraints = {}): Promise<ResolvedMedia> {
    const resolved = input.source === "artifact"
      ? await this.#store.resolve(requireMediaId(input.mediaId))
      : await this.#library.resolve(input, constraints);
    this.#validateResolved(resolved, constraints);
    return resolved;
  }

  async inspect(mediaId: string): Promise<MediaArtifact | undefined> {
    return this.#store.inspect(requireMediaId(mediaId));
  }

  #validateData(input: MediaData, maxBytes: number): void {
    if (!input.data.byteLength) throw new MediaError("MEDIA_INVALID_REQUEST", "Media data is empty");
    if (input.data.byteLength > maxBytes) throw new MediaError("MEDIA_TOO_LARGE", `Media exceeds ${maxBytes} bytes`);
    if (!input.mimeType.trim()) throw new MediaError("MEDIA_INVALID_REQUEST", "Media MIME type is required");
    const detected = detectMimeType(input.data, input.fileName);
    if (detected.kind !== "file" && detected.kind !== input.kind) throw new MediaError("MEDIA_INVALID_REQUEST", `Media bytes are ${detected.kind}, not ${input.kind}`);
    const expectedPrefix = input.kind === "image" ? "image/" : input.kind === "audio" ? "audio/" : undefined;
    if (expectedPrefix && !input.mimeType.startsWith(expectedPrefix)) throw new MediaError("MEDIA_INVALID_REQUEST", `MIME type does not match ${input.kind}`);
  }

  #validateResolved(resolved: ResolvedMedia, constraints: MediaConstraints): void {
    const { artifact } = resolved;
    this.#validateData({ kind: artifact.kind, mimeType: artifact.mimeType, data: resolved.data, ...(artifact.fileName ? { fileName: artifact.fileName } : {}) }, constraints.maxBytes ?? this.#config.maxGeneratedBytes);
    if (constraints.kinds && !constraints.kinds.includes(artifact.kind)) throw new MediaError("MEDIA_UNSUPPORTED", `Adapter does not accept ${artifact.kind}`);
    if (constraints.mimeTypes && !constraints.mimeTypes.includes(artifact.mimeType)) throw new MediaError("MEDIA_UNSUPPORTED", `Adapter does not accept ${artifact.mimeType}`);
    if (artifact.mimeType === "image/gif" && constraints.image?.allowAnimated === false) throw new MediaError("MEDIA_UNSUPPORTED", "Adapter does not accept animated images");
  }
}

function requireMediaId(value: string): string {
  const id = value.trim();
  if (!/^media_[a-f0-9]{32}$/i.test(id)) throw new MediaError("MEDIA_INVALID_REQUEST", "Invalid media artifact ID");
  return id;
}
