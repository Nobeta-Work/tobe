export type MediaKind = "image" | "audio" | "video" | "file";
export type RecognizableMediaKind = "image" | "audio";
export type GeneratableMediaKind = "image" | "audio";

/** Raw or platform-normalized media. This value never enters Agent context. */
export interface MediaData {
  kind: MediaKind;
  mimeType: string;
  data: Uint8Array;
  fileName?: string;
}

/** Internal Adapter <-> Media Pipeline envelope. It must never be serialized to an Agent. */
export interface MediaMetadata extends MediaData {
  size: number;
  sha256: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

interface MediaRefBase {
  type: "media_ref";
  kind: MediaKind;
  description: string;
}

export interface ArtifactMediaRef extends MediaRefBase {
  source: "artifact";
  /** The 12-character YYYYMMDD-??- key, without the kind prefix. */
  id: string;
}

export interface LibraryMediaRef extends MediaRefBase {
  source: "library";
  category: string;
  tag: string;
}

/** The only media value allowed in Engine <-> Agent context. */
export type MediaRef = ArtifactMediaRef | LibraryMediaRef;

/** Explicit local-file input accepted by media_analyze. */
export interface MediaFileInput {
  type: "file";
  path: string;
  kind?: RecognizableMediaKind;
}

export type MediaAnalyzeToolInput = MediaRef | MediaFileInput;
export type MediaAnalyzeInput = MediaRef | MediaData;

export interface MediaAnalyzeRequest {
  prompt?: string;
  inputs: readonly MediaAnalyzeInput[];
}

export interface MediaAnalysis {
  description: string;
  provider: string;
  inputCount: number;
}

export interface MediaConstraints {
  kinds?: readonly MediaKind[];
  mimeTypes?: readonly string[];
  maxBytes?: number;
  image?: { allowAnimated?: boolean; maxWidth?: number; maxHeight?: number };
  audio?: { maxDurationMs?: number };
}

export interface MediaListRequest {
  kind: MediaKind;
}

export interface MediaLibraryIndex {
  kind: MediaKind;
  categories: Record<string, string[]>;
}

export interface MediaGenerateRequest {
  kind: GeneratableMediaKind;
  prompt?: string;
  references?: readonly MediaRef[];
  options?: Readonly<Record<string, unknown>>;
}

/** Provider-facing request after MediaRefs have been resolved. */
export interface MediaModelGenerateRequest {
  kind: GeneratableMediaKind;
  prompt: string;
  references: readonly MediaData[];
  options?: Readonly<Record<string, unknown>>;
}

export interface GeneratedMedia extends MediaData {
  provider: string;
  description?: string;
}

export interface MediaModels {
  readonly id: string;
  analyze(inputs: readonly MediaData[], prompt: string, signal?: AbortSignal): Promise<string>;
  generate(request: MediaModelGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia>;
  canAnalyze(kind: MediaKind): boolean;
  canGenerate(kind: MediaKind): boolean;
}

export interface MediaServiceStatus {
  analysis: Record<RecognizableMediaKind, boolean>;
  generation: Record<GeneratableMediaKind, boolean>;
  libraryKinds: MediaKind[];
}

export interface MediaService {
  status(): Promise<MediaServiceStatus>;
  list(request: MediaListRequest): Promise<MediaLibraryIndex>;
  import(input: MediaData, description?: string): Promise<ArtifactMediaRef>;
  analyze(request: MediaAnalyzeRequest, signal?: AbortSignal): Promise<MediaAnalysis>;
  generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<ArtifactMediaRef>;
  resolve(ref: MediaRef, constraints?: MediaConstraints): Promise<MediaMetadata>;
}

export type MediaErrorCode =
  | "MEDIA_INVALID_REQUEST"
  | "MEDIA_NOT_FOUND"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_UNSUPPORTED"
  | "MEDIA_PROVIDER_UNAVAILABLE"
  | "MEDIA_PROVIDER_FAILED";

export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaError";
  }
}
