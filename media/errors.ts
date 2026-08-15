export type MediaErrorCode =
  | "MEDIA_INVALID_REQUEST"
  | "MEDIA_NOT_FOUND"
  | "MEDIA_EXPIRED"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_UNSUPPORTED"
  | "MEDIA_PROVIDER_UNAVAILABLE"
  | "MEDIA_PROVIDER_FAILED"
  | "MEDIA_LIBRARY_CHANGED";

export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaError";
  }
}

export function mediaErrorResult(error: unknown): { status: "error"; code: string; message: string } {
  if (error instanceof MediaError) return { status: "error", code: error.code, message: error.message };
  return { status: "error", code: "MEDIA_INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
}
