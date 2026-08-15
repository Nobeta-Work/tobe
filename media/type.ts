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
  description?: string;
  createdAt: number;
  expiresAt?: number;
  origin: {
    type: "generated" | "library" | "imported";
    provider?: string;
    library?: string;
    category?: string;
  };
}

export interface MediaRecognition {
  media: Omit<MediaArtifact, "id" | "createdAt" | "expiresAt" | "origin"> & {
    origin: { type: "imported" };
  };
  text: string;
  provider: string;
}

export interface MediaLibraryInput {
  source: "library";
  library: string;
  category: string;
  selection?: "random" | "best";
  revision?: string;
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
  library?: string;
  kind?: MediaKind;
}

export interface MediaLibraryCategory {
  name: string;
  count: number;
  kinds: MediaKind[];
}

export interface MediaLibraryIndex {
  library: string;
  revision: string;
  categories: MediaLibraryCategory[];
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

export interface MediaModelProvider {
  readonly id: string;
  recognize(input: MediaData, signal?: AbortSignal): Promise<string>;
  generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<GeneratedMedia>;
  supportsRecognition(kind: MediaKind): boolean;
  supportsGeneration(kind: MediaKind): boolean;
}

export interface MediaServiceStatus {
  recognition: Record<RecognizableMediaKind, boolean>;
  generation: Record<GeneratableMediaKind, boolean>;
  libraries: string[];
}

export interface MediaService {
  status(): Promise<MediaServiceStatus>;
  list(request?: MediaListRequest): Promise<MediaLibraryIndex[]>;
  recognize(input: MediaData, signal?: AbortSignal): Promise<MediaRecognition>;
  generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaArtifact>;
  resolve(input: MediaInput, constraints?: MediaConstraints): Promise<ResolvedMedia>;
  inspect(mediaId: string): Promise<MediaArtifact | undefined>;
}

export const MEDIA_CAPABILITY = "tobe.media.v1";
