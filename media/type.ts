export type MediaKind = "image" | "audio" | "video" | "file";
export type RecognizableMediaKind = "image" | "audio";
export type GeneratableMediaKind = "image" | "audio";

/** Adapter 已完成平台下载/解密后的 Media 标准输入。 */
export interface MediaData {
  kind: MediaKind;
  mimeType: string;
  data: Uint8Array;
  fileName?: string;
}

/** 可安全写入 Observation 或 Tool Result 的媒体描述，不包含二进制和路径。 */
export interface MediaArtifact {
  version: 1;
  id: string;
  kind: MediaKind;
  mimeType: string;
  fileName?: string;
  size: number;
  sha256: string;
  width?: number;
  height?: number;
  durationMs?: number;
  origin: {
    type: "generated" | "library" | "imported";
    provider?: string;
    category?: string;
    tag?: string;
  };
}

export interface MediaRecognition {
  media: Omit<MediaArtifact, "id" | "origin"> & {
    origin: { type: "imported" };
  };
  text: string;
  provider: string;
}

export interface MediaLibraryInput {
  source: "library";
  kind: MediaKind;
  category: string;
  tag: string;
  selection?: "random" | "best";
}

export interface MediaArtifactInput {
  source: "artifact";
  mediaId: string;
}

export type MediaInput = MediaLibraryInput | MediaArtifactInput;

export interface MediaConstraints {
  kinds?: readonly MediaKind[];
  mimeTypes?: readonly string[];
  maxBytes?: number;
  image?: { allowAnimated?: boolean; maxWidth?: number; maxHeight?: number };
  audio?: { maxDurationMs?: number };
}

export interface ResolvedMedia {
  artifact: MediaArtifact;
  data: Uint8Array;
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
  text: string;
  options?: Readonly<Record<string, unknown>>;
}

export interface GeneratedMedia extends MediaData {
  provider: string;
  description?: string;
}

export interface MediaModels {
  readonly id: string;
  recognize(input: MediaData, signal?: AbortSignal): Promise<string>;
  generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia>;
  canRecognize(kind: MediaKind): boolean;
  canGenerate(kind: MediaKind): boolean;
}

export interface MediaServiceStatus {
  recognition: Record<RecognizableMediaKind, boolean>;
  generation: Record<GeneratableMediaKind, boolean>;
  libraryKinds: MediaKind[];
}

export interface MediaService {
  status(): Promise<MediaServiceStatus>;
  list(request: MediaListRequest): Promise<MediaLibraryIndex>;
  recognize(input: MediaData, signal?: AbortSignal): Promise<MediaRecognition>;
  generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaArtifact>;
  resolve(input: MediaInput, constraints?: MediaConstraints): Promise<ResolvedMedia>;
  inspect(mediaId: string): Promise<MediaArtifact | undefined>;
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
